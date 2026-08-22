import { describe, it, expect } from 'vitest';
import {
  istDayKey, istDayStart, istDayEndExclusive, shiftDays,
  monthStart, previousMonthStart, previousMonthEnd,
  resolveRange, rangeFilter, rangeLabel, withParams,
} from '@/lib/admin/date-range';

const at = (iso: string) => new Date(iso);

describe('a day means an IST day', () => {
  it('starts at 18:30 UTC the previous evening', () => {
    expect(istDayStart('2026-08-22')?.toISOString()).toBe('2026-08-21T18:30:00.000Z');
  });

  it('ends when the next one starts, exclusively', () => {
    // `lte 23:59:59.999` drops anything stamped in the last millisecond, and
    // the database has more precision than that.
    expect(istDayEndExclusive('2026-08-22')?.toISOString()).toBe('2026-08-22T18:30:00.000Z');
  });

  it('puts a late-evening order on the right day', () => {
    // 8pm IST on the 22nd is 14:30 UTC on the 22nd — the bug this file exists
    // for is the one that files that order under the 23rd, or drops it.
    expect(istDayKey(at('2026-08-22T14:30:00Z'))).toBe('2026-08-22');
  });

  it('puts an order just before IST midnight on the day it was placed', () => {
    // 23:59 IST on the 22nd = 18:29 UTC on the 22nd.
    expect(istDayKey(at('2026-08-22T18:29:00Z'))).toBe('2026-08-22');
    // One minute later is the 23rd.
    expect(istDayKey(at('2026-08-22T18:30:00Z'))).toBe('2026-08-23');
  });

  it('refuses anything that is not a day', () => {
    expect(istDayStart('yesterday')).toBeNull();
    expect(istDayStart('2026-8-2')).toBeNull();
    expect(istDayStart('')).toBeNull();
  });
});

describe('the last day of the range is included in full', () => {
  it('covers an order placed at 11pm IST on the "to" day', () => {
    // The failure this prevents: a naive UTC comparison drops the last five and
    // a half hours of the range, which the client reports as "yesterday's
    // orders are missing" a week later.
    const range = resolveRange({ from: '2026-08-01', to: '2026-08-22' });
    const lateOrder = at('2026-08-22T17:30:00Z'); // 11pm IST on the 22nd
    expect(range.gte!.getTime()).toBeLessThanOrEqual(lateOrder.getTime());
    expect(range.lt!.getTime()).toBeGreaterThan(lateOrder.getTime());
  });

  it('excludes the first moment of the following day', () => {
    const range = resolveRange({ from: '2026-08-01', to: '2026-08-22' });
    const nextDay = at('2026-08-22T18:30:00Z'); // midnight IST on the 23rd
    expect(range.lt!.getTime()).toBeLessThanOrEqual(nextDay.getTime());
  });

  it('covers a single day end to end', () => {
    const range = resolveRange({ from: '2026-08-22', to: '2026-08-22' });
    expect(range.gte?.toISOString()).toBe('2026-08-21T18:30:00.000Z');
    expect(range.lt?.toISOString()).toBe('2026-08-22T18:30:00.000Z');
  });
});

describe('presets', () => {
  // 22 Aug 2026 is a Saturday; 09:00 UTC is 14:30 IST, mid-afternoon.
  const now = at('2026-08-22T09:00:00Z');

  it('today is one IST day', () => {
    const r = resolveRange({ preset: 'today' }, now);
    expect([r.fromKey, r.toKey]).toEqual(['2026-08-22', '2026-08-22']);
  });

  it('today is still today late in the IST evening', () => {
    // 20:00 UTC is 1:30am IST the *next* day — the preset must follow IST, not
    // the server's clock, or the evening shift sees an empty "today".
    const r = resolveRange({ preset: 'today' }, at('2026-08-22T20:00:00Z'));
    expect(r.fromKey).toBe('2026-08-23');
  });

  it('last 7 days includes today, so it is seven days not eight', () => {
    const r = resolveRange({ preset: 'last7' }, now);
    expect([r.fromKey, r.toKey]).toEqual(['2026-08-16', '2026-08-22']);
  });

  it('this month runs from the 1st to today, not to the month end', () => {
    // Running to the month end would include a future range and make "this
    // month" and "today" disagree on a total.
    const r = resolveRange({ preset: 'this_month' }, now);
    expect([r.fromKey, r.toKey]).toEqual(['2026-08-01', '2026-08-22']);
  });

  it('last month is the whole of the previous month', () => {
    const r = resolveRange({ preset: 'last_month' }, now);
    expect([r.fromKey, r.toKey]).toEqual(['2026-07-01', '2026-07-31']);
  });

  it('handles last month across a year boundary', () => {
    const r = resolveRange({ preset: 'last_month' }, at('2026-01-15T09:00:00Z'));
    expect([r.fromKey, r.toKey]).toEqual(['2025-12-01', '2025-12-31']);
  });

  it('gets February right, including a leap year', () => {
    expect(previousMonthEnd('2026-03-10')).toBe('2026-02-28');
    expect(previousMonthEnd('2028-03-10')).toBe('2028-02-29');
  });

  it('all time has no bounds at all', () => {
    const r = resolveRange({ preset: 'all' }, now);
    expect(r.gte).toBeNull();
    expect(r.lt).toBeNull();
    expect(rangeFilter(r)).toBeUndefined();
  });
});

describe('bad input does not empty the table', () => {
  it('falls back to all time rather than to nothing', () => {
    // A filter nobody asked for that hides every row looks like data loss.
    expect(resolveRange({ preset: 'lastfortnight' }).preset).toBe('all');
    expect(resolveRange({ from: 'nonsense', to: 'rubbish' }).preset).toBe('all');
  });

  it('swaps a range typed backwards instead of returning nothing', () => {
    const r = resolveRange({ from: '2026-08-22', to: '2026-08-01' });
    expect([r.fromKey, r.toKey]).toEqual(['2026-08-01', '2026-08-22']);
  });

  it('accepts an open-ended range from one side', () => {
    const from = resolveRange({ from: '2026-08-01' });
    expect(from.gte).not.toBeNull();
    expect(from.lt).toBeNull();
    const to = resolveRange({ to: '2026-08-31' });
    expect(to.gte).toBeNull();
    expect(to.lt).not.toBeNull();
  });

  it('lets a preset win over stale dates in the same URL', () => {
    const r = resolveRange({ preset: 'today', from: '2020-01-01', to: '2020-01-31' }, at('2026-08-22T09:00:00Z'));
    expect(r.fromKey).toBe('2026-08-22');
  });
});

describe('labels', () => {
  it('reads as a person would say it', () => {
    expect(rangeLabel('2026-08-22', '2026-08-22')).toBe('22 Aug 2026');
    expect(rangeLabel('2026-08-01', '2026-08-22')).toBe('1 Aug 2026 – 22 Aug 2026');
    expect(rangeLabel('2026-08-01', null)).toBe('From 1 Aug 2026');
    expect(rangeLabel(null, '2026-08-22')).toBe('Up to 22 Aug 2026');
    expect(rangeLabel(null, null)).toBe('All time');
  });
});

describe('filters survive a page turn', () => {
  it('keeps everything already in the URL', () => {
    // Pagination links used to be `?page=2` and nothing else, so the total said
    // one thing and page two said another.
    const qs = withParams({ status: 'CONFIRMED', q: 'ravi', preset: 'last7' }, { page: 2 });
    const params = new URLSearchParams(qs.slice(1));
    expect(params.get('status')).toBe('CONFIRMED');
    expect(params.get('q')).toBe('ravi');
    expect(params.get('preset')).toBe('last7');
    expect(params.get('page')).toBe('2');
  });

  it('drops a key set to null, so a preset can clear custom dates', () => {
    const qs = withParams({ from: '2026-01-01', to: '2026-01-31' }, { preset: 'today', from: null, to: null });
    expect(qs).toBe('?preset=today');
  });

  it('omits empty values rather than writing bare keys', () => {
    expect(withParams({ status: undefined, q: '' }, {})).toBe('');
  });

  it('escapes what it puts in the query string', () => {
    const qs = withParams({ q: 'a&b=c' }, {});
    expect(qs).toContain('q=a%26b%3Dc');
  });
});

describe('day arithmetic', () => {
  it('steps across a month end', () => {
    expect(shiftDays('2026-09-01', -1)).toBe('2026-08-31');
    expect(shiftDays('2026-08-31', 1)).toBe('2026-09-01');
  });

  it('steps across a year end', () => {
    expect(shiftDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('finds the start of a month', () => {
    expect(monthStart('2026-08-22')).toBe('2026-08-01');
    expect(previousMonthStart('2026-01-15')).toBe('2025-12-01');
  });
});
