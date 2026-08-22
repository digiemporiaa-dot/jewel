/**
 * The rate ticker's rules, with no database and no React in them.
 *
 * The important one is what is absent: there is no way to type a rate here. The
 * ticker's numbers come from the same append-only `MetalRate` rows the pricing
 * engine uses. A separately typed "display rate" is how a shop ends up
 * advertising one gold price and charging another, and the customer who notices
 * is holding a screenshot.
 */

export type TickerRate = {
  purityId: string;
  metalName: string;
  purityName: string;
  ratePerGram: string;
  /**
   * ISO 8601, not a `Date`.
   *
   * These rows are read through `unstable_cache`, which stores its result as
   * JSON — a `Date` goes in and a string comes back. Typing it as a `Date`
   * compiled cleanly and threw `getTime is not a function` on the first real
   * page load. The type now says what actually crosses the boundary.
   */
  effectiveFrom: string;
};

/** Background tokens an operator may choose. Names, never CSS. */
export const TICKER_BACKGROUNDS = {
  velvet: { label: 'Velvet (dark green)', bar: 'bg-velvet text-paper', muted: 'text-paper/60', strong: 'text-paper' },
  ink: { label: 'Ink (near black)', bar: 'bg-ink text-paper', muted: 'text-paper/60', strong: 'text-paper' },
  brass: { label: 'Brass', bar: 'bg-brass text-paper', muted: 'text-paper/70', strong: 'text-paper' },
  paper: { label: 'Paper (light)', bar: 'bg-paper-2 text-ink', muted: 'text-ink-soft', strong: 'text-ink' },
} as const;

export type TickerBackground = keyof typeof TICKER_BACKGROUNDS;

export function isTickerBackground(value: unknown): value is TickerBackground {
  return typeof value === 'string' && value in TICKER_BACKGROUNDS;
}

export function tickerBackground(value: unknown) {
  return TICKER_BACKGROUNDS[isTickerBackground(value) ? value : 'velvet'];
}

/**
 * One full pass, in seconds. Below the floor nobody can read a rate; above the
 * ceiling the strip looks frozen and somebody files a bug about it.
 */
export const MIN_SPEED_SECONDS = 15;
export const MAX_SPEED_SECONDS = 180;
export const DEFAULT_SPEED_SECONDS = 40;

export function clampSpeed(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SPEED_SECONDS;
  return Math.min(MAX_SPEED_SECONDS, Math.max(MIN_SPEED_SECONDS, Math.round(n)));
}

export type TickerSettings = {
  isEnabled: boolean;
  purityIds: string[];
  speedSeconds: number;
  background: TickerBackground;
  showTimestamp: boolean;
  message: string | null;
};

export const TICKER_DEFAULTS: TickerSettings = {
  isEnabled: true,
  purityIds: [],
  speedSeconds: DEFAULT_SPEED_SECONDS,
  background: 'velvet',
  showTimestamp: true,
  message: null,
};

/**
 * What a stored row looks like before validation — `background` is a plain
 * column, so it arrives as a string and has to be checked against the list.
 */
export type StoredTickerSettings = {
  isEnabled?: boolean;
  purityIds?: unknown;
  speedSeconds?: unknown;
  background?: unknown;
  showTimestamp?: boolean;
  message?: string | null;
};

/** Normalise a stored row (or nothing at all) into settings safe to render. */
export function resolveSettings(row: StoredTickerSettings | null | undefined): TickerSettings {
  if (!row) return TICKER_DEFAULTS;
  return {
    isEnabled: row.isEnabled ?? TICKER_DEFAULTS.isEnabled,
    purityIds: Array.isArray(row.purityIds)
      ? row.purityIds.filter((id): id is string => typeof id === 'string' && id !== '')
      : [],
    speedSeconds: clampSpeed(row.speedSeconds),
    background: isTickerBackground(row.background) ? row.background : 'velvet',
    showTimestamp: row.showTimestamp ?? TICKER_DEFAULTS.showTimestamp,
    message: row.message?.trim() ? row.message.trim() : null,
  };
}

/**
 * Which rates to show, in the operator's chosen order.
 *
 * A selection that names a purity which has since been deactivated silently
 * drops it rather than rendering a gap — the alternative is a ticker with a
 * blank slot that nobody can explain.
 */
export function selectRates(rates: TickerRate[], purityIds: string[]): TickerRate[] {
  if (purityIds.length === 0) return rates;
  const byId = new Map(rates.map((r) => [r.purityId, r]));
  return purityIds.map((id) => byId.get(id)).filter((r): r is TickerRate => r !== undefined);
}

/**
 * The moment the shown rates were set — the *oldest* of them.
 *
 * Using the newest would let one freshly updated purity vouch for three stale
 * ones. "As on" has to be true of every number on the strip.
 */
export function asOn(rates: TickerRate[]): Date | null {
  let oldest: Date | null = null;
  for (const r of rates) {
    const when = new Date(r.effectiveFrom);
    if (Number.isNaN(when.getTime())) continue;
    if (!oldest || when < oldest) oldest = when;
  }
  return oldest;
}

const IST_OFFSET_MINUTES = 330;

/**
 * "22 Aug, 4:30 pm" in IST, whatever the server's timezone is.
 *
 * Built by hand rather than with `toLocaleString`, because the container's ICU
 * data decides how much of `Asia/Kolkata` exists, and a rate that renders one
 * way in development and another in production is not a timestamp anybody can
 * rely on.
 */
export function formatAsOn(date: Date, now: Date = new Date()): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  const day = ist.getUTCDate();
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][ist.getUTCMonth()];
  const hours24 = ist.getUTCHours();
  const minutes = String(ist.getUTCMinutes()).padStart(2, '0');
  const suffix = hours24 < 12 ? 'am' : 'pm';
  const hours = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const time = `${hours}:${minutes} ${suffix}`;

  const nowIst = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  const sameDay =
    nowIst.getUTCFullYear() === ist.getUTCFullYear() &&
    nowIst.getUTCMonth() === ist.getUTCMonth() &&
    nowIst.getUTCDate() === ist.getUTCDate();

  // "today 4:30 pm" is what a shopper wants to read; the date only earns its
  // space once the rate is not from today.
  return sameDay ? `today ${time}` : `${day} ${month}, ${time}`;
}

/**
 * How stale is too stale to be worth showing.
 *
 * Metal rates move daily. A rate carrying a date from last week undermines every
 * price on the site, so past this point the strip says the rates are being
 * updated instead of quoting a number nobody should act on.
 */
export const STALE_AFTER_HOURS = 48;

export function isStale(asOnDate: Date | null, now: Date = new Date()): boolean {
  if (!asOnDate) return true;
  return now.getTime() - asOnDate.getTime() > STALE_AFTER_HOURS * 3_600_000;
}
