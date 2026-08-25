'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import { getWheelOffer, spinAction, dismissWheel, type WheelOffer } from '@/lib/spin/actions';
import type { PublicSegment } from '@/lib/spin';
import { decideDisplay, isSuppressedPath, SPIN_COOKIE_EVENT, type SpinCookieState } from '@/lib/spin/display';
import { useSpinCookie } from '@/lib/spin/use-spin-cookie';

/**
 * The spin-to-win wheel.
 *
 * Everything the customer can see is decided here; nothing they can win is. The
 * server picks the segment and mints the coupon, and the animation is told where
 * to stop — see lib/spin/actions.ts.
 *
 * The behaviour rules live in lib/spin/display.ts so they are testable, and the
 * accessibility ones are all here: a real close button, Escape, a focus trap
 * while open, focus returned on close, and no spinning animation for anyone who
 * has asked their system for reduced motion.
 */

type Phase = 'idle' | 'spinning' | 'result';

export default function SpinWheel() {
  const pathname = usePathname();
  const [fetched, setFetched] = useState<WheelOffer | null>(null);
  /**
   * The offer as it was when the wheel opened.
   *
   * Held separately from `fetched` because the cookie is written the moment the
   * spin resolves, and the cookie is also what suppresses the wheel. Deriving
   * the open dialog from the live cookie meant it unmounted on success — the
   * customer's prize disappeared at the instant it was awarded. Once open, the
   * dialog owns its data and nothing outside can pull it out from under them.
   */
  const [openOffer, setOpenOffer] = useState<{ name: string; segments: PublicSegment[]; validityDays: number } | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ label: string; won: boolean; code?: string; terms?: string } | null>(null);
  const [rotation, setRotation] = useState(0);

  const dialogRef = useRef<HTMLDivElement>(null);
  const openerFocus = useRef<Element | null>(null);

  // Derived, not stored. A forbidden path and an existing cookie are both known
  // without asking the server, so they gate the fetch rather than being written
  // into state — React 19 rightly objects to a synchronous `setState` in an
  // effect, and the extra render it causes here would be a flash of a popup the
  // visitor already closed.
  const suppressed = isSuppressedPath(pathname);
  const cookie = useSpinCookie();
  const blocked = suppressed || cookie !== null;

  // ── Is there anything to show? ────────────────────────────────────────────
  useEffect(() => {
    // Nothing is fetched on a blocked page, so a visitor who dismissed the
    // wheel costs the server nothing on every page after.
    if (blocked) return;
    let live = true;
    void getWheelOffer(pathname).then((o) => { if (live) setFetched(o); });
    return () => { live = false; };
  }, [pathname, blocked]);

  // Memoised because the trigger effect depends on it: a fresh object literal
  // every render would re-arm the scroll and interval listeners on each pass.
  const offer: WheelOffer | null = useMemo(
    () => (blocked ? { available: false } : fetched),
    [blocked, fetched]
  );

  // Open is "we have a snapshot to show", not a separate flag. One source of
  // truth means the dialog cannot be open with nothing in it, or closed with
  // data still mounted behind it.
  const open = openOffer !== null;

  // ── Triggers ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!offer?.available || open || phase !== 'idle') return;

    const mountedAt = Date.now();
    const isMobile = window.matchMedia('(max-width: 767px)').matches;
    let exitIntent = false;

    const evaluate = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      const decision = decideDisplay({
        pathname,
        hasCampaign: true,
        cookie,
        exitIntent,
        msOnPage: Date.now() - mountedAt,
        scrollFraction: scrollable > 0 ? doc.scrollTop / scrollable : 0,
        isMobile,
      });
      if (decision.show && offer?.available) {
        setOpenOffer({ name: offer.name, segments: offer.segments, validityDays: offer.validityDays });
      }
    };

    // Cursor leaving through the top of the window. Pointer-capable screens
    // only — a touchscreen has no equivalent gesture, and faking one from a
    // scroll-up fires while somebody is still reading.
    const onLeave = (e: MouseEvent) => {
      if (e.clientY <= 0) { exitIntent = true; evaluate(); }
    };
    if (!isMobile) document.addEventListener('mouseout', onLeave);
    window.addEventListener('scroll', evaluate, { passive: true });
    const timer = window.setInterval(evaluate, 1000);

    return () => {
      document.removeEventListener('mouseout', onLeave);
      window.removeEventListener('scroll', evaluate);
      window.clearInterval(timer);
    };
  }, [offer, open, phase, pathname, cookie]);

  const close = useCallback((remember: SpinCookieState | null) => {
    // Back where they were, before the dialog unmounts. Leaving focus on a
    // removed node drops a keyboard user at the top of the document with no
    // idea what happened.
    const opener = openerFocus.current;
    if (opener instanceof HTMLElement) opener.focus();

    setOpenOffer(null);
    if (remember === 'dismissed') void dismissWheel().then(notifyCookieChange);
    else if (remember === 'done') notifyCookieChange();
  }, []);

  // ── Focus trap, Escape, and scroll lock while open ────────────────────────
  useEffect(() => {
    if (!open) return;
    openerFocus.current = document.activeElement;
    const node = dialogRef.current;
    node?.querySelector<HTMLElement>('[data-autofocus]')?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(phase === 'result' ? 'done' : 'dismissed'); return; }
      if (e.key !== 'Tab' || !node) return;
      const focusable = node.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      // Wrap at both ends, so Tab cannot walk out of the dialog into a page the
      // customer cannot see.
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, phase, close]);

  if (!openOffer) return null;
  const segments = openOffer.segments;

  function doSpin() {
    setError(null);
    setPhase('spinning');
    void spinAction(phone).then((res) => {
      if (!res.ok) {
        setError(res.error);
        setPhase('idle');
        return;
      }
      // The server has already decided and already issued the coupon. All the
      // animation does is come to rest on the segment it was told about.
      const index = Math.max(0, segments.findIndex((s) => s.label === res.label));
      const slice = 360 / segments.length;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      // Four extra turns for the flourish, none for anyone who asked for less
      // motion — for whom the wheel simply arrives at the answer.
      const turns = reduced ? 0 : 4;
      setRotation(turns * 360 + (360 - (index * slice + slice / 2)));
      window.setTimeout(() => {
        setResult({
          label: res.label,
          won: res.won,
          code: res.won ? res.code : undefined,
          terms: res.won ? res.terms : undefined,
        });
        setPhase('result');
      }, reduced ? 0 : 3200);
    });
  }

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex',
        // Mobile: a bottom sheet that leaves the page visible above it. A
        // full-screen overlay on a phone is the interstitial Google demotes.
        'items-end justify-center md:items-center',
        'bg-ink/40 backdrop-blur-[2px]'
      )}
      // Clicking the backdrop is a dismissal like any other.
      onClick={(e) => { if (e.target === e.currentTarget) close(phase === 'result' ? 'done' : 'dismissed'); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="spin-title"
        className={cn(
          'relative w-full bg-paper border-t border-line md:border shadow-xl',
          'max-h-[92vh] overflow-y-auto',
          'md:max-w-md md:rounded-none'
        )}
      >
        <button
          onClick={() => close(phase === 'result' ? 'done' : 'dismissed')}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 h-9 w-9 border border-line bg-paper text-lg leading-none text-ink-soft hover:border-brass hover:text-brass"
        >
          ×
        </button>

        <div className="p-6 pt-8 text-center">
          <p className="eyebrow">{openOffer.name}</p>
          <h2 id="spin-title" className="mt-2 text-2xl">
            {phase === 'result' ? (result?.won ? 'You won' : result?.label) : 'Spin for a first-order treat'}
          </h2>

          <Wheel segments={segments.map((s) => s.label)} rotation={rotation} spinning={phase === 'spinning'} />

          {phase !== 'result' && (
            <>
              <label className="mt-5 block text-left text-sm">
                <span className="mb-1 block text-xs text-ink-soft">Mobile number</span>
                <input
                  data-autofocus
                  inputMode="numeric"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  className="w-full border border-line px-3 py-2.5 text-sm outline-none focus:border-brass"
                />
                <span className="mt-1 block text-xs text-ink-soft">
                  One spin per number. Your prize is saved against it and applied when you check out.
                </span>
              </label>

              <button
                onClick={doSpin}
                disabled={phase === 'spinning' || phone.length !== 10}
                className="btn-primary mt-4 w-full"
              >
                {phase === 'spinning' ? 'Spinning…' : 'Spin the wheel'}
              </button>

              {/* Always visible, not folded into the details below. The material
                  terms — what the discount comes off, that it is capped, and how
                  long it lasts — have to be readable without opening anything. */}
              <p className="mt-3 text-left text-xs text-ink-soft">
                Prizes come off making charges only, are capped, and expire in {openOffer.validityDays} days.
                One spin per number.{' '}
                <Link href="/pages/terms" className="underline decoration-line-strong underline-offset-4 hover:text-brass">
                  Full terms
                </Link>
                .
              </p>
            </>
          )}

          {phase === 'result' && (
            <div className="mt-5">
              {result?.won ? (
                <>
                  <p className="text-sm text-ink-soft">{result.label}</p>
                  <p className="mt-3 border border-brass bg-brass/10 px-4 py-3 font-heading text-2xl tracking-[0.12em]">
                    {result.code}
                  </p>
                  <p className="mt-2 text-xs text-ink-soft">{result.terms}</p>
                  <Link href="/c/new-arrivals" className="btn-primary mt-5 inline-flex w-full justify-center">
                    Start shopping
                  </Link>
                </>
              ) : (
                <>
                  {/* A loss is stated plainly. Softening it into a consolation
                      prize would make the wheel a formality, which is exactly
                      what the losing segment is there to avoid. */}
                  <p className="text-sm text-ink-soft">
                    No prize this time — the wheel is a real draw, so sometimes it goes this way.
                  </p>
                  <button onClick={() => close('done')} className="btn-outline mt-5 w-full">Close</button>
                </>
              )}
            </div>
          )}

          {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

          {/* Odds and terms, in the open. Weighted odds are allowed; hiding them
              is what the CCPA dark-pattern guidelines are about. */}
          <details className="mt-5 border-t border-line pt-3 text-left">
            <summary className="cursor-pointer text-xs text-ink-soft">Prizes, odds and terms</summary>
            <ul className="mt-2 space-y-1.5 text-xs text-ink-soft">
              {segments.map((s) => (
                <li key={s.label}>
                  <span className="text-ink">{s.label}</span> — {s.odds}% chance. {s.terms}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-soft">
              One spin per mobile number. Prizes apply to making charges only, not to metal value,
              and each code is single-use, non-transferable and tied to the number that won it.{' '}
              <Link href="/pages/terms" className="underline decoration-line-strong underline-offset-4 hover:text-brass">
                Full terms and conditions
              </Link>
              .
            </p>
          </details>
        </div>
      </div>
    </div>
  );
}

/**
 * The wheel itself.
 *
 * Presentation only — it is handed a final rotation and eases to it. The
 * transition is dropped entirely under `prefers-reduced-motion`, which the CSS
 * handles so the preference is respected even if the media query is re-evaluated
 * mid-spin.
 */
function Wheel({ segments, rotation, spinning }: { segments: string[]; rotation: number; spinning: boolean }) {
  const slice = 360 / segments.length;
  return (
    <div className="relative mx-auto mt-5 h-56 w-56">
      <div
        aria-hidden
        className="absolute left-1/2 top-0 z-10 h-0 w-0 -translate-x-1/2 border-x-8 border-t-[14px] border-x-transparent border-t-velvet"
      />
      <div
        className="spin-wheel h-full w-full rounded-full border-2 border-velvet"
        style={{
          transform: `rotate(${rotation}deg)`,
          background: `conic-gradient(${segments
            .map((_, i) => {
              const colour = i % 2 === 0 ? 'var(--paper-2)' : 'var(--brass)';
              return `${colour} ${i * slice}deg ${(i + 1) * slice}deg`;
            })
            .join(', ')})`,
        }}
      >
        {segments.map((label, i) => (
          <span
            key={label}
            className="absolute left-1/2 top-1/2 origin-left text-[0.6rem] font-medium tracking-wide text-ink"
            style={{ transform: `rotate(${i * slice + slice / 2}deg) translateX(1.6rem)` }}
          >
            {label.length > 16 ? `${label.slice(0, 15)}…` : label}
          </span>
        ))}
      </div>
      {/* Announced rather than only drawn: the wheel is a picture, and a screen
          reader user needs the state in words. */}
      <span className="sr-only" role="status">
        {spinning ? 'Spinning the wheel' : 'Wheel ready'}
      </span>
      <style>{`
        .spin-wheel { transition: transform 3s cubic-bezier(.17,.67,.2,1); position: relative; }
        @media (prefers-reduced-motion: reduce) {
          .spin-wheel { transition: none; }
        }
      `}</style>
    </div>
  );
}

/**
 * Tell every reader of the cookie that it changed.
 *
 * The server action writes it; `document.cookie` does not fire anything on its
 * own, so without this the hook would keep serving the value from before the
 * spin until the next navigation.
 */
function notifyCookieChange(): void {
  window.dispatchEvent(new Event(SPIN_COOKIE_EVENT));
}
