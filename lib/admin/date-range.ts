/**
 * Date filtering for admin lists, in Indian Standard Time.
 *
 * The whole point of this file is the timezone. The database stores UTC, and a
 * naive `createdAt <= '2026-08-22'` comparison drops everything placed after
 * 6:30pm IST on the last day of the range — five and a half hours of orders that
 * the client reports as "yesterday's orders are missing", usually a week later,
 * usually while looking at a figure they have already sent to their accountant.
 *
 * A day here is an IST day: `2026-08-22` runs from 2026-08-21T18:30:00Z up to
 * (but not including) 2026-08-22T18:30:00Z. India has no daylight saving, so the
 * offset is a constant rather than a lookup, and nothing depends on the server's
 * own timezone or on its ICU data.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export type PresetKey = 'all' | 'today' | 'last7' | 'this_month' | 'last_month' | 'custom';

export const PRESETS: { key: Exclude<PresetKey, 'custom'>; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: 'today', label: 'Today' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
];

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** The IST calendar day a moment falls on, as `YYYY-MM-DD`. */
export function istDayKey(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Midnight IST at the start of that day, as a UTC instant. */
export function istDayStart(dayKey: string): Date | null {
  if (!DAY_KEY.test(dayKey)) return null;
  const midnightUtc = new Date(`${dayKey}T00:00:00.000Z`);
  if (Number.isNaN(midnightUtc.getTime())) return null;
  return new Date(midnightUtc.getTime() - IST_OFFSET_MS);
}

/**
 * The instant the IST day ends — which is the start of the next one.
 *
 * Exclusive, so the query is `lt` rather than `lte`. An inclusive
 * `23:59:59.999` bound silently drops anything stamped in the last millisecond,
 * and databases have more precision than that.
 */
export function istDayEndExclusive(dayKey: string): Date | null {
  const start = istDayStart(dayKey);
  if (!start) return null;
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

/** Move an IST day key by whole days. */
export function shiftDays(dayKey: string, days: number): string {
  const start = istDayStart(dayKey);
  if (!start) return dayKey;
  return istDayKey(new Date(start.getTime() + days * 24 * 60 * 60 * 1000));
}

/** First IST day of the month a key falls in. */
export function monthStart(dayKey: string): string {
  return `${dayKey.slice(0, 7)}-01`;
}

/** First IST day of the month before the one a key falls in. */
export function previousMonthStart(dayKey: string): string {
  const year = Number(dayKey.slice(0, 4));
  const month = Number(dayKey.slice(5, 7));
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
}

/** Last IST day of the month before the one a key falls in. */
export function previousMonthEnd(dayKey: string): string {
  return shiftDays(monthStart(dayKey), -1);
}

export type ResolvedRange = {
  preset: PresetKey;
  /** `YYYY-MM-DD`, for the date inputs and for building links. */
  fromKey: string | null;
  toKey: string | null;
  /** UTC instants for the query: `createdAt >= gte AND createdAt < lt`. */
  gte: Date | null;
  lt: Date | null;
  label: string;
};

const ALL: Omit<ResolvedRange, 'preset'> = { fromKey: null, toKey: null, gte: null, lt: null, label: 'All time' };

/**
 * Turn `?preset=`/`?from=`/`?to=` into a range.
 *
 * A preset wins over explicit dates so a preset link is always the same range
 * wherever it is clicked from; anything unrecognised falls back to all time
 * rather than to an empty result, because a filter nobody asked for that hides
 * every row looks like data loss.
 */
export function resolveRange(
  params: { preset?: string; from?: string; to?: string },
  now: Date = new Date()
): ResolvedRange {
  const today = istDayKey(now);
  const preset = params.preset as PresetKey | undefined;

  if (preset && preset !== 'custom') {
    switch (preset) {
      case 'today': return build('today', today, today);
      case 'last7': return build('last7', shiftDays(today, -6), today);
      case 'this_month': return build('this_month', monthStart(today), today);
      case 'last_month': return build('last_month', previousMonthStart(today), previousMonthEnd(today));
      case 'all': return { preset: 'all', ...ALL };
      default: return { preset: 'all', ...ALL };
    }
  }

  const from = params.from && DAY_KEY.test(params.from) ? params.from : null;
  const to = params.to && DAY_KEY.test(params.to) ? params.to : null;
  if (!from && !to) return { preset: 'all', ...ALL };

  // A range typed backwards is a slip, not a request for nothing. Swapping is
  // what the operator meant; an empty table would send them hunting for the
  // orders instead.
  const [lo, hi] = from && to && from > to ? [to, from] : [from, to];
  return build('custom', lo, hi);
}

function build(preset: PresetKey, fromKey: string | null, toKey: string | null): ResolvedRange {
  const gte = fromKey ? istDayStart(fromKey) : null;
  const lt = toKey ? istDayEndExclusive(toKey) : null;
  return { preset, fromKey, toKey, gte, lt, label: rangeLabel(fromKey, toKey) };
}

export function rangeLabel(fromKey: string | null, toKey: string | null): string {
  if (!fromKey && !toKey) return 'All time';
  if (fromKey && toKey) return fromKey === toKey ? pretty(fromKey) : `${pretty(fromKey)} – ${pretty(toKey)}`;
  if (fromKey) return `From ${pretty(fromKey)}`;
  return `Up to ${pretty(toKey!)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pretty(dayKey: string): string {
  const [y, m, d] = dayKey.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

/** A Prisma filter for the range, or undefined when it is unbounded. */
export function rangeFilter(range: ResolvedRange): { gte?: Date; lt?: Date } | undefined {
  if (!range.gte && !range.lt) return undefined;
  return {
    ...(range.gte ? { gte: range.gte } : {}),
    ...(range.lt ? { lt: range.lt } : {}),
  };
}

/**
 * Rebuild the query string with the range and every other filter kept.
 *
 * Pagination links used to be written as `?page=2` and nothing else, which
 * silently dropped the status, the search and the dates the moment somebody
 * turned a page — the filtered total said one thing and page two said another.
 */
export function withParams(
  current: Record<string, string | undefined>,
  changes: Record<string, string | number | null | undefined>
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    if (value !== undefined && value !== '') params.set(key, value);
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined || value === '') params.delete(key);
    else params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}
