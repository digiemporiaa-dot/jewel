import { cn } from '@/lib/utils/cn';
import { PRESETS, withParams, type ResolvedRange } from '@/lib/admin/date-range';

/**
 * From/to filtering for an admin list.
 *
 * Everything is in the URL, so a view is linkable and bookmarkable — a manager
 * can send "last month's orders" to somebody as a link rather than a screenshot,
 * and the browser's back button does what it looks like it does.
 *
 * The presets are links rather than a `<select>`, so each one is its own address
 * and middle-click works. The custom range is a plain GET form: no JavaScript is
 * needed to filter a table.
 *
 * They are plain `<a>` elements rather than `next/link`. Soft navigation to the
 * same route with different search params turned out to be intermittently
 * unreliable here — the RSC stream aborts and the router sits on the old URL, so
 * the button silently does nothing. That is a pre-existing fault (the CRM
 * pipeline cards, which predate this component, fail the same way about a third
 * of the time), but a filter that sometimes ignores a click is worse than a full
 * page load, and an admin table is not a place that needs to avoid one.
 */
export default function DateRangeFilter({
  basePath, range, params, children,
}: {
  basePath: string;
  range: ResolvedRange;
  /** The other filters in the URL, kept whichever way the range changes. */
  params: Record<string, string | undefined>;
  /** Summary line — count and value for the filtered set. */
  children?: React.ReactNode;
}) {
  // Changing the range always returns to page one. Landing on page 7 of a range
  // with two pages shows an empty table, which reads as "no orders".
  const linkFor = (preset: string) =>
    `${basePath}${withParams(params, { preset, from: null, to: null, page: null })}`;

  return (
    <div className="mb-4 border border-line bg-white p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <a
            key={p.key}
            href={linkFor(p.key)}
            className={cn(
              'border px-2.5 py-1 text-xs',
              range.preset === p.key ? 'border-brass bg-brass/10 text-ink' : 'border-line text-ink-soft hover:border-brass'
            )}
          >
            {p.label}
          </a>
        ))}

        <form action={basePath} className="flex flex-wrap items-center gap-2 text-xs">
          {/* Carried through so a date range does not wipe the status or the
              search somebody already applied. */}
          {Object.entries(params)
            .filter(([key, value]) => value !== undefined && value !== '' && key !== 'preset' && key !== 'from' && key !== 'to' && key !== 'page')
            .map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
          <input type="hidden" name="preset" value="custom" />
          <label className="flex items-center gap-1">
            <span className="text-ink-soft">From</span>
            <input type="date" name="from" defaultValue={range.fromKey ?? ''} className="border border-line px-2 py-1 outline-none focus:border-brass" />
          </label>
          <label className="flex items-center gap-1">
            <span className="text-ink-soft">To</span>
            <input type="date" name="to" defaultValue={range.toKey ?? ''} className="border border-line px-2 py-1 outline-none focus:border-brass" />
          </label>
          <button className="btn-outline text-xs py-1">Apply</button>
        </form>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line/60 pt-2 text-sm">
        <span className="text-xs tracking-[0.1em] uppercase text-ink-soft">{range.label}</span>
        {children}
      </div>
    </div>
  );
}
