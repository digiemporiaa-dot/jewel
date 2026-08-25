import { describe, it, expect } from 'vitest';
import {
  parseDateOnly, ageOn, isMinor, resolveMarketingConsent, checkBirthDate,
  signupSchema, profileGaps, DOB_PURPOSE, ANNIVERSARY_PURPOSE, GENDER_PURPOSE,
  GENDERS, GENDER_LABELS, ADULT_AGE,
} from '@/lib/validations/signup';

const NOW = new Date(Date.UTC(2026, 7, 25)); // 25 Aug 2026

describe('date-of-birth parsing', () => {
  it('anchors a date at UTC midnight', () => {
    const d = parseDateOnly('1990-05-14');
    expect(d?.toISOString()).toBe('1990-05-14T00:00:00.000Z');
  });

  it('rejects a day that does not exist rather than rolling it over', () => {
    // `new Date('2025-02-30')` is happy to hand back 2 March. A customer who
    // typo'd their birthday would then be sent an offer on the wrong day, with
    // nothing anywhere to say why.
    expect(parseDateOnly('2025-02-30')).toBeNull();
    expect(parseDateOnly('2025-13-01')).toBeNull();
    expect(parseDateOnly('2025-04-31')).toBeNull();
  });

  it('accepts a real leap day and rejects a fake one', () => {
    expect(parseDateOnly('2024-02-29')).not.toBeNull();
    expect(parseDateOnly('2025-02-29')).toBeNull();
  });

  it('rejects anything that is not exactly YYYY-MM-DD', () => {
    for (const bad of ['', '14/05/1990', '1990-5-14', '1990-05-14T00:00:00Z', 'yesterday']) {
      expect(parseDateOnly(bad), bad).toBeNull();
    }
  });
});

describe('age', () => {
  it('counts whole years, not elapsed milliseconds', () => {
    expect(ageOn(new Date(Date.UTC(2000, 7, 25)), NOW)).toBe(26);
    // The day before the birthday is still the previous age.
    expect(ageOn(new Date(Date.UTC(2000, 7, 26)), NOW)).toBe(25);
    // On the birthday itself, the new age counts.
    expect(ageOn(new Date(Date.UTC(2008, 7, 25)), NOW)).toBe(ADULT_AGE);
  });

  it('treats someone turning 18 today as an adult', () => {
    expect(isMinor(new Date(Date.UTC(2008, 7, 25)), NOW)).toBe(false);
    expect(isMinor(new Date(Date.UTC(2008, 7, 26)), NOW)).toBe(true);
  });
});

describe('marketing consent', () => {
  const adult = new Date(Date.UTC(1990, 4, 14));
  const child = new Date(Date.UTC(2012, 4, 14));

  it('is off unless it is asked for', () => {
    expect(resolveMarketingConsent({ requested: false, dob: adult, now: NOW }))
      .toEqual({ granted: false, refusedBecause: null });
  });

  it('is granted for an adult who asks', () => {
    expect(resolveMarketingConsent({ requested: true, dob: adult, now: NOW }))
      .toEqual({ granted: true, refusedBecause: null });
  });

  it('is refused for a child who asks, and says why', () => {
    // DPDP requires verifiable parental consent for a child's data. A ticked
    // box is not that, so the account is allowed and the marketing is not.
    expect(resolveMarketingConsent({ requested: true, dob: child, now: NOW }))
      .toEqual({ granted: false, refusedBecause: 'minor' });
  });
});

describe('birth date sanity', () => {
  it('rejects a future date and an implausible one', () => {
    expect(checkBirthDate(new Date(Date.UTC(2030, 0, 1)), NOW)).toBe('future');
    expect(checkBirthDate(new Date(Date.UTC(1850, 0, 1)), NOW)).toBe('implausible');
    expect(checkBirthDate(new Date(Date.UTC(1990, 0, 1)), NOW)).toBeNull();
  });
});

describe('the signup form contract', () => {
  const valid = {
    name: 'Ananya Sharma',
    phone: '9810012345',
    email: 'Ananya@Example.COM',
    dob: '1990-05-14',
    gender: 'FEMALE' as const,
    anniversary: '',
    acceptTerms: true as const,
  };

  it('accepts a complete form and lower-cases the email', () => {
    const parsed = signupSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.email).toBe('ananya@example.com');
  });

  it('defaults marketing consent to false when the box sends nothing', () => {
    // An unticked checkbox submits no value at all. That has to read as a
    // refusal, never as "not answered, assume yes".
    const parsed = signupSchema.safeParse(valid);
    expect(parsed.success && parsed.data.marketingOptIn).toBe(false);
  });

  it('requires name, email, date of birth and gender', () => {
    for (const field of ['name', 'email', 'dob', 'gender'] as const) {
      const parsed = signupSchema.safeParse({ ...valid, [field]: '' });
      expect(parsed.success, field).toBe(false);
    }
  });

  it('leaves anniversary optional but validates it when given', () => {
    expect(signupSchema.safeParse({ ...valid, anniversary: '' }).success).toBe(true);
    expect(signupSchema.safeParse({ ...valid, anniversary: '2015-11-30' }).success).toBe(true);
    expect(signupSchema.safeParse({ ...valid, anniversary: '2015-11-31' }).success).toBe(false);
  });

  it('rejects a phone that is not an Indian mobile', () => {
    for (const bad of ['1234567890', '98100123', '+919810012345', '5810012345']) {
      expect(signupSchema.safeParse({ ...valid, phone: bad }).success, bad).toBe(false);
    }
  });

  it('states the purpose of collecting a date of birth', () => {
    // Purpose limitation is a DPDP obligation, and this string is what the form
    // actually shows. Asserting it here stops the promise and the field drifting.
    expect(DOB_PURPOSE).toMatch(/birthday/i);
  });
});

describe('profile gaps', () => {
  it('names what is still missing', () => {
    expect(profileGaps({ name: null, email: null, dob: null, gender: null })).toEqual(['name', 'email', 'dob', 'gender']);
    expect(profileGaps({ name: 'Ananya', email: null, dob: new Date(), gender: 'FEMALE' })).toEqual(['email']);
    expect(profileGaps({ name: 'Ananya', email: 'a@b.com', dob: new Date(), gender: 'MALE' })).toEqual([]);
  });

  it('treats whitespace as missing', () => {
    expect(profileGaps({ name: '   ', email: 'a@b.com', dob: new Date(), gender: 'OTHER' })).toEqual(['name']);
  });

  it('never asks for the phone number', () => {
    // A customer record only exists because a phone was verified, so it cannot
    // be missing — offering to "complete" it would be nonsense.
    const gaps = profileGaps({ name: null, email: null, dob: null, gender: null });
    expect(gaps).not.toContain('phone');
  });
});

/**
 * The path the DOB actually feeds.
 *
 * `lib/campaigns` matches a birthday with `dob.getMonth()` and `dob.getDate()`.
 * That comparison is the reason `parseDateOnly` anchors at UTC midnight, so it
 * is worth pinning here rather than trusting that the two files agree.
 */
describe('a stored date of birth reaches the birthday campaign', () => {
  function matchesOn(dobInput: string, monthOneBased: number, day: number): boolean {
    const dob = parseDateOnly(dobInput);
    if (!dob) return false;
    return dob.getMonth() + 1 === monthOneBased && dob.getDate() === day;
  }

  it('matches on the day the customer typed', () => {
    expect(matchesOn('1990-05-14', 5, 14)).toBe(true);
  });

  it('does not fire a day early or a day late', () => {
    expect(matchesOn('1990-05-14', 5, 13)).toBe(false);
    expect(matchesOn('1990-05-14', 5, 15)).toBe(false);
  });

  it('holds for a date that would shift if it were stored at IST midnight', () => {
    // 1 January is the worst case: an IST-anchored midnight is 31 December in
    // UTC, so a New Year's Day birthday would be wished in the wrong year.
    const dob = parseDateOnly('1992-01-01');
    expect(dob?.getMonth()).toBe(0);
    expect(dob?.getDate()).toBe(1);
  });
});

describe('accepting the terms', () => {
  const base = {
    name: 'Ananya Sharma',
    phone: '9810012345',
    email: 'ananya@example.com',
    dob: '1990-05-14',
    gender: 'FEMALE' as const,
    anniversary: '',
  };

  it('is required', () => {
    expect(signupSchema.safeParse({ ...base, acceptTerms: false }).success).toBe(false);
    expect(signupSchema.safeParse(base).success).toBe(false);
  });

  it('says what to do rather than naming a field', () => {
    const parsed = signupSchema.safeParse({ ...base, acceptTerms: false });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => /accept the terms/i.test(i.message))).toBe(true);
    }
  });

  it('lets the form through once accepted', () => {
    expect(signupSchema.safeParse({ ...base, acceptTerms: true }).success).toBe(true);
  });

  it('is enforced on the server, not only by the browser attribute', () => {
    // A form post can skip the browser entirely, so `required` on the input is
    // a courtesy and this schema is the actual rule.
    expect(signupSchema.safeParse({ ...base, acceptTerms: 'yes' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, acceptTerms: 1 }).success).toBe(false);
  });

  it('does not grant marketing consent by being accepted', () => {
    // The whole reason these are two boxes. A required box cannot carry
    // marketing consent: DPDP wants that free and specific, and consent nobody
    // could refuse without losing their account is neither. Bundling would also
    // quietly empty the birthday campaign's audience.
    const parsed = signupSchema.safeParse({ ...base, acceptTerms: true });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.marketingOptIn).toBe(false);
  });

  it('leaves marketing free to be granted separately', () => {
    const parsed = signupSchema.safeParse({ ...base, acceptTerms: true, marketingOptIn: true });
    expect(parsed.success && parsed.data.marketingOptIn).toBe(true);
  });
});

describe('gender', () => {
  const base = {
    name: 'Ananya Sharma',
    phone: '9810012345',
    email: 'ananya@example.com',
    dob: '1990-05-14',
    anniversary: '',
    acceptTerms: true as const,
  };

  it('offers exactly three options', () => {
    expect([...GENDERS]).toEqual(['MALE', 'FEMALE', 'OTHER']);
    for (const g of GENDERS) expect(GENDER_LABELS[g].length).toBeGreaterThan(0);
  });

  it('is required at signup', () => {
    expect(signupSchema.safeParse(base).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, gender: '' }).success).toBe(false);
  });

  it('rejects anything outside the three', () => {
    // A free-text box produces "M"/"male"/"Male"/"mail" and nothing can segment
    // on that, which is the whole reason this is an enum.
    for (const bad of ['male', 'M', 'Female', 'prefer not to say', 'OTHERS']) {
      expect(signupSchema.safeParse({ ...base, gender: bad }).success, bad).toBe(false);
    }
  });

  it('accepts each of the three', () => {
    for (const g of GENDERS) {
      expect(signupSchema.safeParse({ ...base, gender: g }).success, g).toBe(true);
    }
  });

  it('says what to do rather than naming the enum', () => {
    const parsed = signupSchema.safeParse({ ...base, gender: 'nope' });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => /choose an option/i.test(i.message))).toBe(true);
    }
  });
});

describe('anniversary stays optional', () => {
  const base = {
    name: 'Ananya Sharma',
    phone: '9810012345',
    email: 'ananya@example.com',
    dob: '1990-05-14',
    gender: 'FEMALE' as const,
    acceptTerms: true as const,
  };

  it('is accepted when omitted entirely', () => {
    expect(signupSchema.safeParse(base).success).toBe(true);
  });

  it('is accepted when blank', () => {
    expect(signupSchema.safeParse({ ...base, anniversary: '' }).success).toBe(true);
  });

  it('is still validated when given', () => {
    expect(signupSchema.safeParse({ ...base, anniversary: '2015-11-30' }).success).toBe(true);
    expect(signupSchema.safeParse({ ...base, anniversary: '2015-11-31' }).success).toBe(false);
  });
});

describe('every required field explains why it is being asked for', () => {
  it('states a purpose for date of birth, anniversary and gender', () => {
    // Purpose limitation is a DPDP obligation, and these are the strings the
    // form renders — asserted here so the promise and the field cannot drift.
    expect(DOB_PURPOSE).toMatch(/birthday/i);
    expect(ANNIVERSARY_PURPOSE).toMatch(/anniversary/i);
    expect(GENDER_PURPOSE).toMatch(/relevant/i);
  });
});
