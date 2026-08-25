'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import { getWheelOffer, spinAction, dismissWheel, type WheelOffer } from '@/lib/spin/actions';
import type { PublicSegment } from '@/lib/spin';
import type { ResolvedPresentation } from '@/lib/spin/segments';
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
  const [openOffer, setOpenOffer] = useState<{
    name: string; segments: PublicSegment[]; validityDays: number; look: ResolvedPresentation;
  } | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ label: string; won: boolean; code?: string; terms?: string } | null>(null);
  const [rotation, setRotation] = useState(0);

  const dialogRef = useRef<HTMLDivElement>(null);
  const openerFocus = useRef<Element | null>(null);
  /** What the server awarded, held from the moment it answers until it is shown. */
  const pendingResult = useRef<{ label: string; won: boolean; code?: string; terms?: string } | null>(null);
  /**
   * When this page view began, for the dwell trigger.
   *
   * Initialised to 0 and set on first effect run rather than from `useRef(Date.now())`
   * — reading the clock during render is impure, and React may render more than
   * once before anything is shown.
   */
  const arrivedAt = useRef(0);

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
    () => (blocked ? ({ available: false } as WheelOffer) : fetched),
    [blocked, fetched]
  );

  // Open is "we have a snapshot to show", not a separate flag. One source of
  // truth means the dialog cannot be open with nothing in it, or closed with
  // data still mounted behind it.
  const open = openOffer !== null;

  // ── Triggers ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!offer?.available || open || phase !== 'idle') return;

    // From the ref, not from this effect. The effect re-runs when the offer
    // fetch resolves, and restarting the clock there meant "30 seconds on the
    // page" silently became "30 seconds after the campaign query came back".
    if (arrivedAt.current === 0) arrivedAt.current = Date.now();
    const mountedAt = arrivedAt.current;
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
        setOpenOffer({ name: offer.name, segments: offer.segments, validityDays: offer.validityDays, look: offer.look });
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

  /** Show what the server already awarded, whether or not the wheel finished. */
  const reveal = useCallback(() => {
    const pending = pendingResult.current;
    if (!pending) return;
    pendingResult.current = null;
    setResult(pending);
    setPhase('result');
  }, []);

  const close = useCallback((remember: SpinCookieState | null) => {
    // Closing mid-spin shows the prize instead of discarding it.
    //
    // The coupon has already been issued and they cannot spin again, so
    // dismissing here would destroy the only copy of a code they have won. The
    // result screen it lands on is itself fully dismissible, so nothing is
    // trapped — the first press stops the animation, not the offer.
    if (pendingResult.current) { reveal(); return; }

    // Back where they were, before the dialog unmounts. Leaving focus on a
    // removed node drops a keyboard user at the top of the document with no
    // idea what happened.
    const opener = openerFocus.current;
    if (opener instanceof HTMLElement) opener.focus();

    setOpenOffer(null);
    if (remember === 'dismissed') void dismissWheel().then(notifyCookieChange);
    else if (remember === 'done') notifyCookieChange();
  }, [reveal]);

  // ── Focus trap, Escape, and scroll lock while open ────────────────────────
  useEffect(() => {
    if (!open) return;
    // Only captured once, on the way in — re-reading it after the phase changes
    // would record the dialog's own button as the thing to return to.
    openerFocus.current ??= document.activeElement;
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
  const look = openOffer.look;
  const dark = look.background === 'velvet';

  function doSpin() {
    setError(null);
    setPhase('spinning');
    void spinAction(phone).then((res) => {
      if (!res.ok) {
        setError(res.error);
        setPhase('idle');
        return;
      }
      // Held before the animation starts, not after it ends.
      //
      // The coupon already exists at this point and the customer cannot spin
      // again. If they close the wheel or press Escape mid-spin, the code must
      // not go with it — so the result waits here and is revealed either when
      // the wheel stops or the moment they try to leave.
      pendingResult.current = {
        label: res.label,
        won: res.won,
        code: res.won ? res.code : undefined,
        terms: res.won ? res.terms : undefined,
      };

      // The server has already decided and already issued the coupon. All the
      // animation does is come to rest on the segment it was told about.
      const index = Math.max(0, segments.findIndex((s) => s.label === res.label));
      const slice = 360 / segments.length;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      // Four extra turns for the flourish, none for anyone who asked for less
      // motion — for whom the wheel simply arrives at the answer.
      const turns = reduced ? 0 : 4;
      setRotation(turns * 360 + (360 - (index * slice + slice / 2)));
      window.setTimeout(reveal, reduced ? 0 : 3200);
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
          'relative w-full border-t md:border shadow-xl',
          'max-h-[92vh] overflow-y-auto',
          'md:max-w-md md:rounded-none',
          // Two complete class sets, never an interpolated one — Tailwind cannot
          // see a class built from a variable and would omit it from the build.
          dark ? 'bg-velvet text-paper border-velvet-2' : 'bg-paper text-ink border-line'
        )}
      >
        <button
          onClick={() => close(phase === 'result' ? 'done' : 'dismissed')}
          aria-label="Close"
          className={cn(
            'absolute right-3 top-3 z-10 h-9 w-9 border text-lg leading-none hover:border-brass hover:text-brass',
            dark ? 'border-paper/30 bg-velvet text-paper/70' : 'border-line bg-paper text-ink-soft'
          )}
        >
          ×
        </button>

        <div className="p-6 pt-8 text-center">
          {/* Every string below is the shop's, falling back to ours. */}
          <p className={cn('eyebrow', dark && 'text-paper/70')}>{look.eyebrow || openOffer.name}</p>
          <h2 id="spin-title" className={cn('mt-2 text-2xl', dark && 'text-paper')}>
            {phase === 'result' ? (result?.won ? look.winHeading : result?.label) : look.heading}
          </h2>
          {phase !== 'result' && look.subheading && (
            <p className={cn('mt-2 text-sm', dark ? 'text-paper/70' : 'text-ink-soft')}>{look.subheading}</p>
          )}

          {look.imageUrl && (
            // A plain <img>: the URL comes from the shop's own uploader and the
            // dialog is never server-rendered, so next/image buys nothing here.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={look.imageUrl}
              alt={look.imageAlt || ''}
              className="mx-auto mt-4 max-h-32 w-auto object-contain"
            />
          )}

          <Wheel segments={segments} rotation={rotation} spinning={phase === 'spinning'} dark={dark} />

          {phase !== 'result' && (
            <>
              <label className="mt-5 block text-left text-sm">
                <span className={cn('mb-1 block text-xs', dark ? 'text-paper/70' : 'text-ink-soft')}>{look.phoneLabel}</span>
                <input
                  data-autofocus
                  inputMode="numeric"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  className="w-full border border-line px-3 py-2.5 text-sm outline-none focus:border-brass"
                />
                <span className={cn('mt-1 block text-xs', dark ? 'text-paper/70' : 'text-ink-soft')}>{look.phoneHint}</span>
              </label>

              <button
                onClick={doSpin}
                disabled={phase === 'spinning' || phone.length !== 10}
                className="btn-primary mt-4 w-full"
              >
                {phase === 'spinning' ? 'Spinning…' : look.buttonLabel}
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
                  {/* Focused on arrival: the input that had focus is gone, and
                      without this a keyboard user lands back at the top of the
                      document with no idea a code was awarded. `tabIndex={-1}`
                      makes it focusable without adding it to the tab order. */}
                  <p
                    data-autofocus
                    tabIndex={-1}
                    role="status"
                    className="mt-3 border border-brass bg-brass/10 px-4 py-3 font-heading text-2xl tracking-[0.12em] outline-none"
                  >
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
                  <p className={cn('text-sm', dark ? 'text-paper/70' : 'text-ink-soft')}>{look.loseMessage}</p>
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
            <p className={cn('mt-2 text-xs', dark ? 'text-paper/70' : 'text-ink-soft')}>
              {look.footnote && <span className="mb-1 block">{look.footnote}</span>}
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
function Wheel({
  segments, rotation, spinning, dark,
}: {
  segments: PublicSegment[]; rotation: number; spinning: boolean; dark: boolean;
}) {
  const slice = 360 / segments.length;
  return (
    <div className="relative mx-auto mt-5 h-56 w-56">
      {/* The pointer and the rim have to contrast with the *dialog*, not with
          the wheel. Both were fixed velvet, which disappeared entirely once the
          shop could choose a velvet popup. */}
      <div
        aria-hidden
        className={cn(
          'absolute left-1/2 top-0 z-10 h-0 w-0 -translate-x-1/2 border-x-8 border-t-[14px] border-x-transparent',
          dark ? 'border-t-brass' : 'border-t-velvet'
        )}
      />
      <div
        className={cn('spin-wheel h-full w-full rounded-full border-2', dark ? 'border-paper/40' : 'border-velvet')}
        style={{
          transform: `rotate(${rotation}deg)`,
          // Literal hex resolved on the server from a closed token list, so the
          // client never builds a class name Tailwind cannot see.
          background: `conic-gradient(${segments
            .map((s, i) => `${s.fill} ${i * slice}deg ${(i + 1) * slice}deg`)
            .join(', ')})`,
        }}
      >
        {segments.map((s, i) => {
          const mid = i * slice + slice / 2;
          // Anything on the left half would otherwise render upside-down, which
          // is exactly where half the prizes on a five-segment wheel sit.
          const flipped = mid > 90 && mid < 270;
          return (
            <span
              key={s.label}
              aria-hidden
              className="absolute inset-0 flex items-center justify-end pr-2"
              style={{ transform: `rotate(${mid}deg)` }}
            >
              <span
                className="block max-w-[5.6rem] truncate text-[0.6rem] font-medium tracking-wide"
                style={{
                  transform: flipped ? 'rotate(180deg)' : undefined,
                  // Paired with the fill on the server so a dark wedge always
                  // gets light text — contrast is not left to whoever picks a
                  // colour.
                  color: s.text,
                }}
              >
                {s.label}
              </span>
            </span>
          );
        })}
      </div>
      {/* Announced rather than only drawn: the wheel is a picture, and a screen
          reader user needs the state in words. */}
      {/* The wedges are `aria-hidden` — rotated, truncated text is noise to a
          screen reader, and the same prizes are listed in full, with their odds,
          in the terms panel below. */}
      <span className="sr-only" role="status">
        {spinning ? 'Spinning the wheel' : `Wheel ready, with ${segments.length} segments`}
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
