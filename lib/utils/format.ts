import { Prisma } from '@prisma/client';

type Numeric = number | string | Prisma.Decimal | null | undefined;

function toNumber(value: Numeric): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

/**
 * The single currency formatter for the whole app. Uses Indian number grouping
 * (₹1,25,000). Never hand-format money anywhere else.
 *
 * Returns a safe fallback for un-computable prices so the UI never shows
 * ₹0 / ₹NaN / ₹undefined (see brief §65).
 */
export function formatCurrency(
  value: Numeric,
  opts: { currency?: string; fallback?: string; withDecimals?: boolean } = {}
): string {
  const { currency = 'INR', fallback = 'Price on request', withDecimals = false } =
    opts;
  const n = toNumber(value);
  if (n === null) return fallback;

  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: withDecimals ? 2 : 0,
    maximumFractionDigits: withDecimals ? 2 : 0,
  }).format(n);
}

/** Indian-grouped plain number (no currency symbol). */
export function formatNumber(value: Numeric, fractionDigits = 0): string {
  const n = toNumber(value);
  if (n === null) return '—';
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(n);
}

/** Weight in grams, e.g. "4.230 g". */
export function formatWeight(value: Numeric): string {
  const n = toNumber(value);
  if (n === null) return '—';
  return `${formatNumber(n, 3)} g`;
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
}
