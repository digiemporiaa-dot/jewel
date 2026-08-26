'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import {
  TICKER_BACKGROUNDS, MIN_SPEED_SECONDS, MAX_SPEED_SECONDS, type TickerSettings,
} from '@/lib/rates/ticker';
import { saveTickerSettingsAction } from './actions';

type Purity = { purityId: string; metalName: string; purityName: string };

/**
 * The storefront rate strip.
 *
 * There is no rate field on this form, and that is the point: the strip shows
 * the same `MetalRate` rows the pricing engine uses. A second place to type a
 * gold rate is how a shop advertises one number and charges another.
 */
export default function TickerSettingsForm({
  settings, available,
}: {
  settings: TickerSettings;
  available: Purity[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(settings.purityIds);
  const [speed, setSpeed] = useState(settings.speedSeconds);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null); setError(null);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = await saveTickerSettingsAction(fd);
      if (res.ok) { setMsg('Ticker updated'); router.refresh(); }
      else setError(res.error ?? 'Failed');
    });
  }

  function toggle(purityId: string) {
    setSelected((prev) => (prev.includes(purityId) ? prev.filter((id) => id !== purityId) : [...prev, purityId]));
  }

  return (
    <form onSubmit={submit} className="border border-line bg-white">
      <div className="px-5 py-3 border-b border-line">
        <h2 className="font-heading text-lg">Storefront rate ticker</h2>
      </div>

      <div className="p-5 space-y-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="isEnabled" defaultChecked={settings.isEnabled} />
          <span>Show the rate strip at the top of the site</span>
        </label>

        <div>
          <p className="mb-1.5 text-xs text-ink-soft">
            Which rates to show — leave all unticked for every active purity. The order you tick
            them in is the order they appear.
          </p>
          <div className="flex flex-wrap gap-2">
            {available.map((p) => {
              const on = selected.includes(p.purityId);
              return (
                <button
                  key={p.purityId}
                  type="button"
                  onClick={() => toggle(p.purityId)}
                  aria-pressed={on}
                  className={cn(
                    'border px-2.5 py-1 text-xs',
                    on ? 'border-brass bg-brass/10 text-ink' : 'border-line text-ink-soft'
                  )}
                >
                  {p.metalName} {p.purityName}
                  {on && <span className="ml-1 text-brass">#{selected.indexOf(p.purityId) + 1}</span>}
                </button>
              );
            })}
          </div>
          {selected.map((id) => <input key={id} type="hidden" name="purityIds" value={id} />)}
          {available.length === 0 && (
            <p className="text-xs text-ink-soft">No live rates yet — set one above and this fills in.</p>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="block mb-1 text-xs text-ink-soft">
              Speed — {speed}s for one pass ({MIN_SPEED_SECONDS}–{MAX_SPEED_SECONDS})
            </span>
            <input
              name="speedSeconds"
              type="range"
              min={MIN_SPEED_SECONDS}
              max={MAX_SPEED_SECONDS}
              step={5}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="w-full"
            />
            <span className="text-xs text-ink-soft">Higher is slower. It pauses on hover either way.</span>
          </label>

          <label className="block">
            <span className="block mb-1 text-xs text-ink-soft">Background</span>
            <select name="background" defaultValue={settings.background} className="t-inp">
              {Object.entries(TICKER_BACKGROUNDS).map(([key, v]) => (
                <option key={key} value={key}>{v.label}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="block mb-1 text-xs text-ink-soft">Message alongside the rates (optional)</span>
          <input
            name="message"
            defaultValue={settings.message ?? ''}
            maxLength={120}
            placeholder="BIS Hallmarked · Certified Diamonds · Pan-India Delivery"
            className="t-inp"
          />
        </label>

        {/* No "show the timestamp" toggle any more.
            The strip does not carry one at all — a scrolling time is noise where
            nothing is being committed, and it invites a customer to treat a
            marquee as the record of what they were charged. Leaving a switch
            here that changed nothing would be the same lie the campaign
            switches used to tell. */}
        <p className="text-xs text-ink-soft">
          The strip shows the rate only. When the rate was set appears on each product&apos;s price
          breakup and on the order itself, which is what answers a dispute. If the latest rate is
          more than two days old the strip says the rates are being updated rather than quoting a
          stale number.
        </p>

        {error && <p className="text-xs text-red-700">{error}</p>}
        {msg && <p className="text-xs text-ink-soft">{msg}</p>}

        <button disabled={pending} className="btn-primary text-xs">
          {pending ? 'Saving…' : 'Save ticker'}
        </button>
      </div>
      <style>{`.t-inp{width:100%;border:1px solid var(--line);padding:.45rem .6rem;font-size:.85rem;outline:none}.t-inp:focus{border-color:var(--brass)}`}</style>
    </form>
  );
}
