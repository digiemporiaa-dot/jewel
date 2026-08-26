import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  normalizeIndianMobile, toStoredPhone, formatIndianMobile, isJunkPhone, phoneField,
  PHONE_INVALID, PHONE_JUNK,
} from '@/lib/validations/phone';
import { parseOtpChannels, DEFAULT_OTP_CHANNELS } from '@/lib/otp-channels';
import { profileGaps } from '@/lib/validations/signup';

vi.mock('server-only', () => ({}));

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('one phone rule, reused everywhere', () => {
  it('parses every way a real number is written', () => {
    for (const written of ['9810012345', '+91 98100 12345', '098100-12345', '919810012345', ' 98100 12345 ']) {
      expect(normalizeIndianMobile(written), written).toBe('919810012345');
      expect(toStoredPhone(written), written).toBe('9810012345');
    }
  });

  it('refuses anything outside the Indian mobile range', () => {
    for (const bad of ['1234567890', '5810012345', '98100123', '98100123456789', '', 'not a number']) {
      expect(toStoredPhone(bad), bad).toBeNull();
    }
  });

  it('stores ten digits, not the gateway form', () => {
    // Every Customer row and every `where: { phone }` in this codebase uses ten
    // digits. Storing 91-prefixed would orphan them all behind a key nothing
    // looks them up by.
    expect(toStoredPhone('+919810012345')).toBe('9810012345');
    expect(toStoredPhone('+919810012345')).not.toBe(normalizeIndianMobile('+919810012345'));
  });

  it('formats for display without changing what is stored', () => {
    expect(formatIndianMobile('9810012345')).toBe('+91 98100 12345');
    expect(formatIndianMobile(null)).toBe('—');
    expect(formatIndianMobile('')).toBe('—');
    // An unparseable legacy value is shown as it is rather than hidden.
    expect(formatIndianMobile('12345')).toBe('12345');
  });

  it('rejects the placeholders that would otherwise reach a courier', () => {
    for (const junk of ['9999999999', '6666666666', '9876543210', '+91 98765 43210']) {
      expect(isJunkPhone(junk), junk).toBe(true);
    }
  });

  it('does not reject a real number for looking tidy', () => {
    // A filter working on a hunch turns a paying customer away at checkout,
    // which is worse than one bad number reaching the CRM.
    for (const real of ['9810012345', '9000000000', '9123456780', '7011223344']) {
      expect(isJunkPhone(real), real).toBe(false);
    }
  });

  it('says which problem it found', () => {
    const shape = phoneField.safeParse('12345');
    expect(shape.success).toBe(false);
    if (!shape.success) expect(shape.error.issues[0]?.message).toBe(PHONE_INVALID);

    const junk = phoneField.safeParse('9999999999');
    expect(junk.success).toBe(false);
    if (!junk.success) expect(junk.error.issues[0]?.message).toBe(PHONE_JUNK);
  });

  it('is the only implementation in the repo', () => {
    // The rule was written four times: here, in lib/sms, in the checkout schema
    // and in the spin action. Four copies is how they start disagreeing about
    // what a valid number is.
    expect(read('lib/sms/provider.ts')).toContain("export { normalizeIndianMobile } from '@/lib/validations/phone'");
    for (const file of ['lib/validations/checkout.ts', 'lib/spin/actions.ts', 'app/(storefront)/appointments/actions.ts']) {
      expect(read(file), file).toContain('phoneField');
      expect(read(file), file).not.toMatch(/regex\(\/\^\(?\\?\+?9?1?\)?\[6-9\]/);
    }
  });
});

describe('which channel a code is sent on', () => {
  it('is email alone until phone is switched on', () => {
    expect(parseOtpChannels(undefined)).toEqual([...DEFAULT_OTP_CHANNELS]);
    expect(parseOtpChannels('')).toEqual(['email']);
    expect(parseOtpChannels('email')).toEqual(['email']);
  });

  it('takes phone when it is listed', () => {
    expect(parseOtpChannels('email,phone')).toEqual(['email', 'phone']);
    expect(parseOtpChannels(' PHONE , email ')).toEqual(['phone', 'email']);
  });

  it('falls back rather than switching sign-in off on a typo', () => {
    // An unparseable value must not leave a shop with no way to send a code.
    expect(parseOtpChannels('sms')).toEqual(['email']);
    expect(parseOtpChannels(',,,')).toEqual(['email']);
  });
});

describe('email is the identifier, phone is required and unverified', () => {
  const signup = read('app/(storefront)/signup/actions.ts');
  const checkout = read('app/(storefront)/checkout/actions.ts');
  const otp = read('lib/otp.ts');

  it('sends the signup code to the email address', () => {
    expect(signup).toContain("sendOtp(parsed.data, 'EMAIL_VERIFY')");
    expect(signup).not.toContain("'PHONE_VERIFY'");
  });

  it('keys the customer on the address that was just proven', () => {
    for (const source of [signup, checkout]) {
      expect(source).toContain('where: { email: parsed');
      expect(source).toContain('emailVerified: true');
    }
  });

  it('never sets phoneVerified from a path that verifies an email', () => {
    // The column is the honest record of which numbers were ever proven. A
    // signup that marked it true would erase the distinction it exists for.
    for (const source of [signup, checkout]) {
      expect(source).not.toContain('phoneVerified: true');
    }
  });

  it('holds the phone channel behind the switch', () => {
    expect(otp).toContain("isOtpChannelEnabled('phone')");
    expect(otp).toContain("isOtpChannelEnabled('email')");
  });

  it('lists a missing phone as a gap now that nothing guarantees one', () => {
    const bare = { name: null, email: null, phone: null, dob: null, gender: null };
    expect(profileGaps(bare)).toContain('phone');
    expect(profileGaps({ ...bare, phone: '9810012345' })).not.toContain('phone');
    // Callers that do not select the column are not made to claim it is missing.
    expect(profileGaps({ name: 'A', email: 'a@b.co', dob: new Date(), gender: 'MALE' })).not.toContain('phone');
  });
});

describe('the admin can find the records that predate the rule', () => {
  const crm = read('lib/admin/crm.ts');
  const page = read('app/admin/(protected)/customers/page.tsx');

  it('filters on either identifier being absent', () => {
    expect(crm).toContain('incomplete?: boolean');
    expect(crm).toContain('{ OR: [{ email: null }, { phone: null }] }');
  });

  it('offers it as a control, not a hand-written query string', () => {
    expect(page).toContain('name="incomplete"');
    expect(page).toContain('Missing email or phone');
  });

  it('shows the gap on the row and formats the number', () => {
    expect(page).toContain('No phone');
    expect(page).toContain('No email');
    expect(page).toContain('formatIndianMobile(c.phone)');
  });
});
