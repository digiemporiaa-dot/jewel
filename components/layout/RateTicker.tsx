import { getTickerData } from '@/lib/rates/ticker-settings';
import { formatCurrency } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import {
  selectRates, asOn, formatAsOn, isStale, tickerBackground, type TickerRate,
} from '@/lib/rates/ticker';

/**
 * The live rate strip at the top of the site.
 *
 * A server component: the rates are rendered into the HTML, and the cache tag is
 * busted when an admin saves a rate. Nothing here polls, and no rate number
 * reaches the browser as data — only as text.
 *
 * The height is fixed whatever the state, so the strip cannot push the page down
 * once the rates arrive. A layout shift at the very top of the document is the
 * worst place to have one.
 */
export default async function RateTicker() {
  const { settings, rates } = await getTickerData();
  if (!settings.isEnabled) return null;

  const shown = selectRates(rates, settings.purityIds);
  const asOnDate = asOn(shown);
  const theme = tickerBackground(settings.background);

  // Stale rates are worse than no rates: every price on the site is derived from
  // them, so quoting a number from last week undermines the whole catalogue.
  if (shown.length === 0 || isStale(asOnDate)) {
    return (
      <div className={cn('h-9', theme.bar)}>
        <div className="shell flex h-9 items-center">
          <span className={cn('text-[0.7rem] tracking-[0.14em] uppercase', theme.muted)}>
            Today&apos;s rates are being updated
          </span>
        </div>
      </div>
    );
  }

  const stamp = settings.showTimestamp && asOnDate ? `as on ${formatAsOn(asOnDate)}` : null;
  const items = <Items rates={shown} stamp={stamp} message={settings.message} theme={theme} />;

  return (
    <div className={cn('h-9', theme.bar)}>
      {/* `--rate-marquee-duration` is the only thing an operator's choice
          reaches: a number of seconds, in a custom property. Not a class name
          they typed, and not a style string. */}
      <div
        className="rate-marquee relative h-9 overflow-hidden"
        style={{ ['--rate-marquee-duration' as string]: `${settings.speedSeconds}s` }}
      >
        {/*
          Two identical copies scrolling by exactly half the track width is what
          makes the loop seamless. A screen reader should hear the rates once, so
          the second copy is hidden from the accessibility tree — and the first
          copy is what a reader lands on, in reading order.
        */}
        <div className="rate-marquee-track flex h-9 w-max items-center">
          <div className="flex h-9 items-center">{items}</div>
          <div className="flex h-9 items-center" aria-hidden="true">{items}</div>
        </div>
      </div>
    </div>
  );
}

function Items({
  rates, stamp, message, theme,
}: {
  rates: TickerRate[];
  stamp: string | null;
  message: string | null;
  theme: ReturnType<typeof tickerBackground>;
}) {
  return (
    <>
      {message && (
        <span className={cn('whitespace-nowrap px-5 text-[0.7rem] tracking-[0.14em] uppercase', theme.strong)}>
          {message}
        </span>
      )}
      {rates.map((r) => (
        <span
          key={r.purityId}
          className="whitespace-nowrap px-5 text-[0.7rem] tracking-[0.12em] uppercase"
        >
          <span className={theme.muted}>{r.metalName} {r.purityName}</span>{' '}
          <span className={cn('font-medium', theme.strong)}>{formatCurrency(r.ratePerGram)}/g</span>
        </span>
      ))}
      {stamp && (
        // The timestamp travels with the rates rather than sitting in a corner:
        // whichever part of the strip is on screen, the time it was set is next
        // to it. A rate without a time is a customer dispute waiting to happen.
        <span className={cn('whitespace-nowrap px-5 text-[0.65rem] tracking-[0.1em] uppercase', theme.muted)}>
          {stamp}
        </span>
      )}
    </>
  );
}
