'use client';

import { useEffect, useRef, useState } from 'react';
import {
  RING_SIZES, BANGLE_SIZES, RING_STEPS, BANGLE_STEPS, SIZE_GUIDE_TITLES,
  type SizeGuideKind,
} from '@/lib/products/size-guide';

/**
 * The size chart, one tap from the size selector.
 *
 * Wrong-size orders are the main avoidable return in this category, and it is
 * the one question a photograph cannot answer. Putting the chart on a separate
 * page loses the shopper mid-decision, so it opens over the buy box and closes
 * back to it.
 *
 * A native `<dialog>` rather than a hand-rolled overlay: it gets the top layer,
 * focus trapping, Escape and inertness from the browser instead of from a
 * hundred lines here that would get one of them wrong.
 */
export default function SizeGuide({ kind }: { kind: SizeGuideKind }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const steps = kind === 'ring' ? RING_STEPS : BANGLE_STEPS;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs underline decoration-line-strong underline-offset-4 hover:text-brass"
      >
        {SIZE_GUIDE_TITLES[kind]}
      </button>

      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        // Clicking the backdrop closes it. The check is on the target being the
        // dialog itself, which is only true for the backdrop — a click inside
        // lands on a child.
        onClick={(e) => { if (e.target === ref.current) setOpen(false); }}
        aria-labelledby="size-guide-title"
        className="w-[min(34rem,92vw)] max-h-[85vh] overflow-y-auto border border-line bg-paper p-0 text-ink backdrop:bg-ink/40"
      >
        <div className="sticky top-0 flex items-center justify-between gap-4 border-b border-line bg-paper px-5 py-3">
          <h2 id="size-guide-title" className="font-heading text-lg">{SIZE_GUIDE_TITLES[kind]}</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close size guide"
            className="text-xl leading-none text-ink-soft hover:text-ink"
          >
            ×
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          <section>
            <h3 className="eyebrow">How to measure</h3>
            <ol className="mt-2 space-y-1.5 text-sm text-ink-soft">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-brass">{i + 1}.</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <h3 className="eyebrow">{kind === 'ring' ? 'Indian ring sizes' : 'Bangle sizes'}</h3>
            <div className="mt-2 overflow-x-auto">
              {kind === 'ring' ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-ink-soft">
                      <th className="py-2 font-medium">Size</th>
                      <th className="py-2 font-medium">Inside diameter</th>
                      <th className="py-2 font-medium">Circumference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {RING_SIZES.map((r) => (
                      <tr key={r.size} className="border-b border-line/60">
                        <td className="py-1.5">{r.size}</td>
                        <td className="py-1.5 text-ink-soft">{r.diameterMm.toFixed(1)} mm</td>
                        <td className="py-1.5 text-ink-soft">{r.circumferenceMm.toFixed(1)} mm</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-ink-soft">
                      <th className="py-2 font-medium">Size</th>
                      <th className="py-2 font-medium">Diameter</th>
                      <th className="py-2 font-medium">In millimetres</th>
                    </tr>
                  </thead>
                  <tbody>
                    {BANGLE_SIZES.map((b) => (
                      <tr key={b.size} className="border-b border-line/60">
                        <td className="py-1.5">{b.size}</td>
                        <td className="py-1.5 text-ink-soft">{b.diameterInches}&quot;</td>
                        <td className="py-1.5 text-ink-soft">{b.diameterMm.toFixed(1)} mm</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <p className="text-xs text-ink-soft">
            Between two sizes? Take the larger. Resizing a plain band is usually possible; a fully
            set eternity ring or a closed bangle is not, so measure twice for those.
          </p>
        </div>
      </dialog>
    </>
  );
}
