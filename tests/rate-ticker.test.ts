import { describe, it, expect } from 'vitest';
import {
  resolveSettings, selectRates, asOn, formatAsOn, isStale, clampSpeed,
  tickerBackground, isTickerBackground, TICKER_DEFAULTS,
  MIN_SPEED_SECONDS, MAX_SPEED_SECONDS, STALE_AFTER_HOURS,
  type TickerRate,
} from '@/lib/rates/ticker';
import { tickerSettingsSchema } from '@/lib/validations/rates';

const at = (iso: string) => new Date(iso);

function rate(purityId: string, iso: string, over: Partial<TickerRate> = {}): TickerRate {
  return {
    purityId,
    metalName: 'Gold',
    purityName: '22K',
    ratePerGram: '6560.00',
    effectiveFrom: iso,
    ...over,
  };
}

describe('the ticker holds no rate of its own', () => {
  it('has no way to set one', () => {
    // The point of the whole feature. If this ever fails because a rate field
    // was added to the settings, the shop can advertise one price and charge
    // another, and the customer who notices is holding a screenshot.
    const keys = Object.keys(TICKER_DEFAULTS);
    expect(keys).not.toContain('ratePerGram');
    expect(keys.some((k) => /rate/i.test(k))).toBe(false);
  });

  it('rejects a rate smuggled through the settings form', () => {
    const parsed = tickerSettingsSchema.safeParse({
      isEnabled: true, showTimestamp: true, speedSeconds: 40,
      background: 'velvet', message: '', purityIds: [],
      ratePerGram: '9999',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect('ratePerGram' in parsed.data).toBe(false);
  });
});

describe('which rates appear', () => {
  const rates = [rate('a', '2026-08-22T04:00:00Z'), rate('b', '2026-08-22T05:00:00Z'), rate('c', '2026-08-22T06:00:00Z')];

  it('shows everything when nothing is chosen', () => {
    expect(selectRates(rates, []).map((r) => r.purityId)).toEqual(['a', 'b', 'c']);
  });

  it('respects the order the operator ticked them in', () => {
    expect(selectRates(rates, ['c', 'a']).map((r) => r.purityId)).toEqual(['c', 'a']);
  });

  it('drops a purity that has since been deactivated rather than leaving a gap', () => {
    // The alternative is a blank slot in the strip that nobody can explain.
    expect(selectRates(rates, ['a', 'gone', 'b']).map((r) => r.purityId)).toEqual(['a', 'b']);
  });

  it('copes with a selection that matches nothing at all', () => {
    expect(selectRates(rates, ['x', 'y'])).toEqual([]);
  });
});

describe('"as on" is true of every rate shown', () => {
  it('survives the cache, which turns dates into strings', () => {
    // The rows are read through `unstable_cache`, which stores its result as
    // JSON. Typing this field as a Date compiled cleanly and threw
    // "getTime is not a function" on the first real page load.
    const cached = JSON.parse(JSON.stringify([rate('a', '2026-08-22T04:00:00Z')])) as TickerRate[];
    expect(asOn(cached)?.toISOString()).toBe('2026-08-22T04:00:00.000Z');
  });

  it('ignores a row whose timestamp is unreadable', () => {
    const rates = [rate('a', 'not-a-date'), rate('b', '2026-08-22T04:00:00Z')];
    expect(asOn(rates)?.toISOString()).toBe('2026-08-22T04:00:00.000Z');
  });

  it('takes the oldest, not the newest', () => {
    // The newest would let one freshly updated purity vouch for three stale
    // ones sitting next to it.
    const rates = [rate('a', '2026-08-22T06:00:00Z'), rate('b', '2026-08-21T09:00:00Z')];
    expect(asOn(rates)?.toISOString()).toBe('2026-08-21T09:00:00.000Z');
  });

  it('is nothing when there is nothing to show', () => {
    expect(asOn([])).toBeNull();
  });
});

describe('the timestamp reads in IST', () => {
  it('converts UTC to Indian time', () => {
    // 04:00 UTC is 09:30 IST.
    expect(formatAsOn(at('2026-08-21T04:00:00Z'), at('2026-08-22T04:00:00Z'))).toBe('21 Aug, 9:30 am');
  });

  it('says "today" when the rate was set today in IST', () => {
    expect(formatAsOn(at('2026-08-22T04:00:00Z'), at('2026-08-22T10:00:00Z'))).toBe('today 9:30 am');
  });

  it('reads midnight and noon the way a person says them', () => {
    // 18:30 UTC = 00:00 IST the next day.
    expect(formatAsOn(at('2026-08-21T18:30:00Z'), at('2026-08-25T00:00:00Z'))).toBe('22 Aug, 12:00 am');
    // 06:30 UTC = 12:00 IST.
    expect(formatAsOn(at('2026-08-22T06:30:00Z'), at('2026-08-25T00:00:00Z'))).toBe('22 Aug, 12:00 pm');
  });

  it('is the same whatever the server thinks its timezone is', () => {
    // Built by hand rather than via toLocaleString, whose output depends on the
    // container's ICU data.
    expect(formatAsOn(at('2026-01-05T20:00:00Z'), at('2026-02-01T00:00:00Z'))).toBe('6 Jan, 1:30 am');
  });
});

describe('stale rates are not quoted', () => {
  const now = at('2026-08-22T12:00:00Z');

  it('accepts a rate set today', () => {
    expect(isStale(at('2026-08-22T04:00:00Z'), now)).toBe(false);
  });

  it('accepts a rate just inside the window', () => {
    expect(isStale(new Date(now.getTime() - (STALE_AFTER_HOURS - 1) * 3_600_000), now)).toBe(false);
  });

  it('refuses a rate from last week', () => {
    // Every price on the site derives from these numbers, so quoting an old one
    // undermines the whole catalogue.
    expect(isStale(at('2026-08-14T04:00:00Z'), now)).toBe(true);
  });

  it('treats no rate at all as stale', () => {
    expect(isStale(null, now)).toBe(true);
  });
});

describe('speed', () => {
  it('will not go faster than a person can read', () => {
    expect(clampSpeed(1)).toBe(MIN_SPEED_SECONDS);
  });

  it('will not go so slow it looks frozen', () => {
    expect(clampSpeed(9999)).toBe(MAX_SPEED_SECONDS);
  });

  it('falls back rather than emitting NaN into a CSS duration', () => {
    expect(clampSpeed('nonsense')).toBe(TICKER_DEFAULTS.speedSeconds);
    expect(clampSpeed(undefined)).toBe(TICKER_DEFAULTS.speedSeconds);
  });

  it('rejects an out-of-range speed on save, with a reason', () => {
    const res = tickerSettingsSchema.safeParse({
      isEnabled: true, showTimestamp: true, speedSeconds: 2,
      background: 'velvet', message: '', purityIds: [],
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]?.message).toMatch(/Too fast/);
  });
});

describe('background is a token, never CSS', () => {
  it('accepts the listed tokens', () => {
    for (const token of ['velvet', 'ink', 'brass', 'paper']) expect(isTickerBackground(token)).toBe(true);
  });

  it('refuses anything else, including real CSS', () => {
    expect(isTickerBackground('#ff0000')).toBe(false);
    expect(isTickerBackground('red; background-image:url(javascript:alert(1))')).toBe(false);
    expect(isTickerBackground('')).toBe(false);
  });

  it('falls back to a readable pair rather than rendering an empty class', () => {
    const theme = tickerBackground('nonsense');
    expect(theme.bar).toContain('bg-velvet');
    expect(theme.strong.length).toBeGreaterThan(0);
  });

  it('is refused on save', () => {
    const res = tickerSettingsSchema.safeParse({
      isEnabled: true, showTimestamp: true, speedSeconds: 40,
      background: 'rgb(1,2,3)', message: '', purityIds: [],
    });
    expect(res.success).toBe(false);
  });
});

describe('reading a stored row', () => {
  it('gives an unconfigured shop a working strip', () => {
    expect(resolveSettings(null)).toEqual(TICKER_DEFAULTS);
  });

  it('repairs a row edited directly in the database', () => {
    const s = resolveSettings({
      isEnabled: true,
      purityIds: ['a', '', 'b'] as unknown as string[],
      speedSeconds: 1,
      background: 'chartreuse',
      showTimestamp: true,
      message: '   ',
    });
    expect(s.purityIds).toEqual(['a', 'b']);
    expect(s.speedSeconds).toBe(MIN_SPEED_SECONDS);
    expect(s.background).toBe('velvet');
    expect(s.message).toBeNull();
  });
});
