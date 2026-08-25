import { describe, it, expect } from 'vitest';
import { istInputToUtc, utcToIstInput, formatIst, IST_OFFSET_MINUTES } from '@/lib/utils/datetime';

/**
 * The bug this file exists for: a `datetime-local` input submits a bare wall
 * clock with no offset, so `new Date(value)` parsed it in the container's
 * timezone — UTC in production. A campaign set for 2:26 PM IST did not start
 * until 7:56 PM IST, and an active, correctly configured wheel simply did not
 * appear on the storefront.
 */

describe('an admin-entered wall clock is IST', () => {
  it('stores 14:26 as 08:56 UTC', () => {
    expect(istInputToUtc('2026-08-25T14:26')?.toISOString()).toBe('2026-08-25T08:56:00.000Z');
  });

  it('round-trips back to the value that was typed', () => {
    const stored = istInputToUtc('2026-08-25T14:26');
    expect(utcToIstInput(stored)).toBe('2026-08-25T14:26');
  });

  it('shifts by exactly five and a half hours', () => {
    const stored = istInputToUtc('2026-01-01T00:00');
    expect(stored?.toISOString()).toBe('2025-12-31T18:30:00.000Z');
    // Crossing midnight backwards is the case a naive implementation gets wrong.
    expect(utcToIstInput(stored)).toBe('2026-01-01T00:00');
  });

  it('uses the same offset both ways', () => {
    expect(IST_OFFSET_MINUTES).toBe(330);
    const now = new Date('2026-06-15T12:34:00.000Z');
    expect(istInputToUtc(utcToIstInput(now))?.toISOString()).toBe(now.toISOString());
  });

  it('accepts seconds when a browser sends them', () => {
    expect(istInputToUtc('2026-08-25T14:26:30')?.toISOString()).toBe('2026-08-25T08:56:30.000Z');
  });
});

describe('a campaign window is judged on the clock the shop set it in', () => {
  it('is active at 14:30 IST when it starts at 14:26 IST', () => {
    const startsAt = istInputToUtc('2026-08-25T14:26');
    const at1430Ist = istInputToUtc('2026-08-25T14:30');
    expect(startsAt).not.toBeNull();
    expect(at1430Ist!.getTime()).toBeGreaterThan(startsAt!.getTime());
  });

  it('is not yet active at 14:00 IST', () => {
    const startsAt = istInputToUtc('2026-08-25T14:26')!;
    const at1400Ist = istInputToUtc('2026-08-25T14:00')!;
    expect(at1400Ist.getTime()).toBeLessThan(startsAt.getTime());
  });

  it('was the live failure: 14:30 IST is before the old UTC-parsed start', () => {
    // What the broken code stored for "14:26": the wall clock read as UTC.
    const wronglyStored = new Date('2026-08-25T14:26:00.000Z');
    const at1430Ist = istInputToUtc('2026-08-25T14:30')!;
    // 14:30 IST is 09:00 UTC — still four and a half hours short of the start
    // the shop never intended to set.
    expect(at1430Ist.getTime()).toBeLessThan(wronglyStored.getTime());
  });
});

describe('bad input', () => {
  it('returns null rather than a wrong instant', () => {
    for (const bad of ['', '2026-08-25', '25/08/2026 14:26', 'now', '2026-08-25T25:00']) {
      expect(istInputToUtc(bad), bad).toBeNull();
    }
  });

  it('rejects a day that does not exist instead of rolling it over', () => {
    // `new Date('2026-02-30T10:00')` is happy to hand back 2 March, which would
    // move a campaign by two days with nothing anywhere to say why.
    expect(istInputToUtc('2026-02-30T10:00')).toBeNull();
    expect(istInputToUtc('2026-04-31T10:00')).toBeNull();
  });

  it('accepts a real leap day and rejects a fake one', () => {
    expect(istInputToUtc('2028-02-29T10:00')).not.toBeNull();
    expect(istInputToUtc('2026-02-29T10:00')).toBeNull();
  });

  it('renders nothing for an absent or invalid instant', () => {
    expect(utcToIstInput(null)).toBe('');
    expect(utcToIstInput(new Date('nonsense'))).toBe('');
    expect(formatIst(null)).toBe('—');
  });
});

describe('reading an instant back to a human', () => {
  it('names the timezone, so nobody has to guess which clock it is', () => {
    expect(formatIst(new Date('2026-08-25T08:56:00.000Z'))).toBe('25 Aug 2026, 14:26 IST');
  });
});
