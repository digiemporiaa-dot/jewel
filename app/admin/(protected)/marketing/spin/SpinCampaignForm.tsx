'use client';

import { useState, useTransition } from 'react';
import { cn } from '@/lib/utils/cn';
import { useRouter } from 'next/navigation';
import { saveCampaignAction } from './actions';
import ImageUploadField from '@/components/admin/ImageUploadField';
import {
  ALLOWED_SCOPES, SCOPE_LABELS, SEGMENT_COLOURS, COLOUR_LABELS, COLOUR_HEX,
  totalWeight, describePrize, PRESENTATION_DEFAULTS,
  type SpinSegment, type SpinPresentation, type SegmentColour,
} from '@/lib/spin/segments';

type Defaults = {
  id?: string;
  name: string;
  isActive: boolean;
  perPhoneLimit: number;
  couponValidityDays: number;
  startsAt: string;
  endsAt: string;
  segments: SpinSegment[];
  presentation: SpinPresentation;
  /** Coupons already created in the Coupons screen, offered as prize templates. */
  coupons: { id: string; code: string; summary: string }[];
};

/**
 * Editing the wheel.
 *
 * The odds column is computed from the weights as they are typed, because a
 * weight is meaningless on its own — an operator setting "10" has no idea
 * whether that is a rare prize or a common one until they can see the
 * percentage, and the percentage is what the customer will be shown.
 */
export default function SpinCampaignForm({ defaults }: { defaults: Defaults }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState(defaults);

  const total = totalWeight(form.segments);

  function set<K extends keyof Defaults>(key: K, value: Defaults[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setSegment(index: number, patch: Partial<SpinSegment>) {
    setForm((f) => ({
      ...f,
      segments: f.segments.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  }

  function setLook<K extends keyof SpinPresentation>(key: K, value: SpinPresentation[K]) {
    setForm((f) => ({ ...f, presentation: { ...f.presentation, [key]: value } }));
  }

  function setPrize(index: number, patch: Record<string, unknown>) {
    setForm((f) => ({
      ...f,
      segments: f.segments.map((s, i) =>
        i === index ? ({ ...s, prize: { ...s.prize, ...patch } } as SpinSegment) : s
      ),
    }));
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setMsg(null);
    start(async () => {
      const res = await saveCampaignAction({ ...form, segments: form.segments, presentation: form.presentation });
      if (res.ok) { setMsg('Saved'); router.refresh(); }
      else setError(res.error ?? 'Could not save');
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5 text-sm">
      <div className="border border-line bg-white p-5 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <L label="Campaign name">
            <input value={form.name} onChange={(e) => set('name', e.target.value)} required className="sp-inp" />
          </L>
          <L label="Spins per mobile number">
            <input
              type="number" min={1} max={10} value={form.perPhoneLimit}
              onChange={(e) => set('perPhoneLimit', Number(e.target.value))} className="sp-inp"
            />
          </L>
          <L label="Prize valid for (days)">
            <input
              type="number" min={1} max={365} value={form.couponValidityDays}
              onChange={(e) => set('couponValidityDays', Number(e.target.value))} className="sp-inp"
            />
          </L>
          <L label="Live">
            <label className="flex items-center gap-2 py-2">
              <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
              <span className="text-xs text-ink-soft">
                {form.isActive ? 'Showing on the storefront' : 'Off — nothing shows to customers'}
              </span>
            </label>
          </L>
          <L label="Starts (optional, IST)">
            <input type="datetime-local" value={form.startsAt} onChange={(e) => set('startsAt', e.target.value)} className="sp-inp" />
          </L>
          <L label="Ends (optional, IST)">
            <input type="datetime-local" value={form.endsAt} onChange={(e) => set('endsAt', e.target.value)} className="sp-inp" />
          </L>
        </div>
      </div>

      <div className="border border-line bg-white p-5 space-y-3">
        <div>
          <h2 className="font-heading text-lg">What the wheel says</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            Leave a field blank to use the built-in wording. These are plain text
            fields — there is no HTML or styling box, so nothing typed here can
            break the page or inject anything.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <L label="Eyebrow (small line above the heading)">
            <input value={form.presentation.eyebrow ?? ''} onChange={(e) => setLook('eyebrow', e.target.value)} placeholder={form.name} className="sp-inp" />
          </L>
          <L label="Heading">
            <input value={form.presentation.heading ?? ''} onChange={(e) => setLook('heading', e.target.value)} placeholder={PRESENTATION_DEFAULTS.heading} className="sp-inp" />
          </L>
          <L label="Subheading">
            <input value={form.presentation.subheading ?? ''} onChange={(e) => setLook('subheading', e.target.value)} className="sp-inp" />
          </L>
          <L label="Button label">
            <input value={form.presentation.buttonLabel ?? ''} onChange={(e) => setLook('buttonLabel', e.target.value)} placeholder={PRESENTATION_DEFAULTS.buttonLabel} className="sp-inp" />
          </L>
          <L label="Label above the phone box">
            <input value={form.presentation.phoneLabel ?? ''} onChange={(e) => setLook('phoneLabel', e.target.value)} placeholder={PRESENTATION_DEFAULTS.phoneLabel} className="sp-inp" />
          </L>
          <L label="Note under the phone box">
            <input value={form.presentation.phoneHint ?? ''} onChange={(e) => setLook('phoneHint', e.target.value)} placeholder={PRESENTATION_DEFAULTS.phoneHint} className="sp-inp" />
          </L>
          <L label="Heading when they win">
            <input value={form.presentation.winHeading ?? ''} onChange={(e) => setLook('winHeading', e.target.value)} placeholder={PRESENTATION_DEFAULTS.winHeading} className="sp-inp" />
          </L>
          <L label="Message when they win nothing">
            <input value={form.presentation.loseMessage ?? ''} onChange={(e) => setLook('loseMessage', e.target.value)} placeholder={PRESENTATION_DEFAULTS.loseMessage} className="sp-inp" />
          </L>
          <L label="Extra line in the terms">
            <input value={form.presentation.footnote ?? ''} onChange={(e) => setLook('footnote', e.target.value)} className="sp-inp" />
          </L>
          <L label="Popup background">
            <select
              value={form.presentation.background ?? 'paper'}
              onChange={(e) => setLook('background', e.target.value === 'velvet' ? 'velvet' : 'paper')}
              className="sp-inp"
            >
              <option value="paper">Ivory</option>
              <option value="velvet">Deep green</option>
            </select>
          </L>
        </div>

        <ImageUploadField
          label="Picture above the wheel (optional)"
          prefix="cms"
          hint="Shown at the top of the popup. A logo or a product shot works well."
          value={form.presentation.imageUrl ?? ''}
          onChange={(v) => setLook('imageUrl', v)}
          altName="spinImageAlt"
          altLabel="Alt text"
          altValue={form.presentation.imageAlt ?? ''}
          onAltChange={(v) => setLook('imageAlt', v)}
          requireAlt
        />
      </div>

      <div className="border border-line bg-white p-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg">Prizes</h2>
            <p className="mt-0.5 text-xs text-ink-soft">
              Weights are relative — the odds column shows what each one actually works out to, and
              that is the figure shown to the customer.
            </p>
          </div>
          <button
            type="button"
            onClick={() => set('segments', [...form.segments, { label: 'New segment', weight: 10, prize: { kind: 'NONE' } }])}
            className="btn-outline text-xs shrink-0"
          >
            Add segment
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {form.segments.map((segment, i) => {
            const odds = total > 0 ? Math.round((segment.weight / total) * 1000) / 10 : 0;
            const prize = segment.prize;
            return (
              <div key={i} className="border border-line p-3 space-y-3">
                <div className="grid sm:grid-cols-[1fr_7rem_5rem_auto] gap-2 items-end">
                  <L label="Label on the wheel">
                    <input value={segment.label} onChange={(e) => setSegment(i, { label: e.target.value })} className="sp-inp" />
                  </L>
                  <L label="Weight">
                    <input
                      type="number" min={1} value={segment.weight}
                      onChange={(e) => setSegment(i, { weight: Number(e.target.value) })} className="sp-inp"
                    />
                  </L>
                  <L label="Odds">
                    <p className="py-2 font-medium">{odds}%</p>
                  </L>
                  <button
                    type="button"
                    onClick={() => set('segments', form.segments.filter((_, idx) => idx !== i))}
                    className="btn-outline text-xs text-red-700 border-red-300 mb-0.5"
                  >
                    Remove
                  </button>
                </div>

                <div className="grid sm:grid-cols-2 gap-2">
                  <L label="Prize">
                    <select
                      value={prize.kind}
                      onChange={(e) => {
                        const kind = e.target.value;
                        setSegment(i, {
                          prize:
                            kind === 'NONE'
                              ? { kind: 'NONE' }
                              : kind === 'TEMPLATE'
                                ? { kind: 'TEMPLATE', couponId: defaults.coupons[0]?.id ?? '', couponCode: defaults.coupons[0]?.code ?? '' }
                                : { kind: 'COUPON', type: 'PERCENTAGE', appliesTo: 'MAKING_CHARGES', value: 5, maxDiscount: 1000, minOrder: null },
                        });
                      }}
                      className="sp-inp"
                    >
                      <option value="NONE">Wins nothing</option>
                      <option value="COUPON">A discount set here</option>
                      <option value="TEMPLATE" disabled={defaults.coupons.length === 0}>
                        {defaults.coupons.length === 0 ? 'One of my coupons (none eligible)' : 'One of my coupons'}
                      </option>
                    </select>
                  </L>

                  <L label="Colour on the wheel">
                    <div className="flex flex-wrap gap-1.5 py-1">
                      {SEGMENT_COLOURS.map((c) => {
                        const active = (segment.colour ?? (i % 2 === 0 ? 'paper' : 'brass')) === c;
                        return (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setSegment(i, { colour: c })}
                            aria-label={COLOUR_LABELS[c]}
                            aria-pressed={active}
                            title={COLOUR_LABELS[c]}
                            className={cn(
                              'h-7 w-7 border-2 transition-colors',
                              active ? 'border-ink' : 'border-line hover:border-line-strong'
                            )}
                            style={{ background: COLOUR_HEX[c as SegmentColour].fill }}
                          />
                        );
                      })}
                    </div>
                  </L>
                </div>

                {prize.kind === 'TEMPLATE' && (
                  <>
                    <L label="Which coupon">
                      <select
                        value={prize.couponId}
                        onChange={(e) => {
                          const chosen = defaults.coupons.find((c) => c.id === e.target.value);
                          setPrize(i, { couponId: e.target.value, couponCode: chosen?.code ?? '' });
                        }}
                        className="sp-inp"
                      >
                        {defaults.coupons.map((c) => (
                          <option key={c.id} value={c.id}>{c.code} — {c.summary}</option>
                        ))}
                      </select>
                    </L>
                    {/* Said plainly, because it is the thing an operator will
                        otherwise assume works the other way. */}
                    <p className="text-xs text-ink-soft">
                      Its terms are copied when somebody wins, and each winner gets their own
                      single-use code locked to their number — the shared code is never handed out.
                      Only coupons scoped to making charges or stone value, with a cap where they are
                      a percentage, can be used here.
                    </p>
                  </>
                )}

                {prize.kind === 'COUPON' && (
                  <>
                    <div className="grid sm:grid-cols-4 gap-2">
                      <L label="Type">
                        <select
                          value={prize.type}
                          onChange={(e) => setPrize(i, { type: e.target.value, maxDiscount: e.target.value === 'FLAT' ? null : (prize.maxDiscount ?? 1000) })}
                          className="sp-inp"
                        >
                          <option value="PERCENTAGE">Percentage</option>
                          <option value="FLAT">Flat ₹</option>
                        </select>
                      </L>
                      <L label={prize.type === 'PERCENTAGE' ? 'Percent off' : 'Rupees off'}>
                        <input type="number" min={1} value={prize.value} onChange={(e) => setPrize(i, { value: Number(e.target.value) })} className="sp-inp" />
                      </L>
                      <L label="Taken off">
                        {/* Only the two scopes with margin in them. Order total
                            and metal value are not offered at all: gold sells at
                            the live rate, so a discount there is paid out of
                            stock sold at cost. */}
                        <select value={prize.appliesTo} onChange={(e) => setPrize(i, { appliesTo: e.target.value })} className="sp-inp">
                          {ALLOWED_SCOPES.map((scope) => (
                            <option key={scope} value={scope}>{SCOPE_LABELS[scope]}</option>
                          ))}
                        </select>
                      </L>
                      <L label={prize.type === 'PERCENTAGE' ? 'Cap (₹, required)' : 'Cap (n/a)'}>
                        <input
                          type="number" min={1}
                          disabled={prize.type === 'FLAT'}
                          value={prize.maxDiscount ?? ''}
                          onChange={(e) => setPrize(i, { maxDiscount: e.target.value === '' ? null : Number(e.target.value) })}
                          className="sp-inp disabled:bg-paper-2"
                        />
                      </L>
                    </div>
                    <L label="Minimum order (₹, optional)">
                      <input
                        type="number" min={0}
                        value={prize.minOrder ?? ''}
                        onChange={(e) => setPrize(i, { minOrder: e.target.value === '' ? null : Number(e.target.value) })}
                        className="sp-inp"
                      />
                    </L>
                    <p className="text-xs text-ink-soft">
                      Customer sees: {describePrize(prize, form.couponValidityDays)}
                    </p>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {msg && <p className="text-sm text-ink-soft">{msg}</p>}

      <button disabled={pending} className="btn-primary text-xs">
        {pending ? 'Saving…' : 'Save campaign'}
      </button>
      <style>{`.sp-inp{width:100%;border:1px solid var(--line);padding:.45rem .6rem;font-size:.85rem;outline:none}.sp-inp:focus{border-color:var(--brass)}`}</style>
    </form>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs text-ink-soft">{label}</span>{children}</label>;
}
