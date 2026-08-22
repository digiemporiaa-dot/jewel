import { describe, it, expect } from 'vitest';
import {
  istDayKey, whatsappDedupeKey, cartDedupeKey, whatsappNote, abandonedCartNote,
} from '@/lib/leads/capture';
import { leadTitle, leadContact, isUnreachable } from '@/lib/admin/lead-display';

describe('the day bucket', () => {
  it('uses IST, not UTC', () => {
    // 19:00 UTC is 00:30 the next day in Delhi. Bucketing on UTC would file an
    // evening's browsing under yesterday — and evening is when people shop.
    expect(istDayKey(new Date('2026-08-22T19:00:00Z'))).toBe('2026-08-23');
    expect(istDayKey(new Date('2026-08-22T18:29:00Z'))).toBe('2026-08-22');
  });

  it('rolls over at 18:30 UTC, which is midnight IST', () => {
    expect(istDayKey(new Date('2026-08-22T18:29:59Z'))).toBe('2026-08-22');
    expect(istDayKey(new Date('2026-08-22T18:30:00Z'))).toBe('2026-08-23');
  });
});

describe('the WhatsApp de-duplication key', () => {
  const at = new Date('2026-08-22T10:00:00Z');

  it('is the same for repeat clicks by one shopper on one piece in one day', () => {
    const a = whatsappDedupeKey({ identity: { kind: 'session', token: 'sess-1' }, productId: 'p1', at });
    const b = whatsappDedupeKey({
      identity: { kind: 'session', token: 'sess-1' },
      productId: 'p1',
      at: new Date('2026-08-22T15:00:00Z'),
    });
    expect(a).toBe(b);
  });

  it('differs per product, so two enquiries on two pieces are two leads', () => {
    const a = whatsappDedupeKey({ identity: { kind: 'session', token: 's' }, productId: 'p1', at });
    const b = whatsappDedupeKey({ identity: { kind: 'session', token: 's' }, productId: 'p2', at });
    expect(a).not.toBe(b);
  });

  it('differs per shopper', () => {
    const a = whatsappDedupeKey({ identity: { kind: 'session', token: 's1' }, productId: 'p', at });
    const b = whatsappDedupeKey({ identity: { kind: 'session', token: 's2' }, productId: 'p', at });
    expect(a).not.toBe(b);
  });

  it('never confuses a customer id with a session token of the same value', () => {
    const a = whatsappDedupeKey({ identity: { kind: 'customer', id: 'x' }, productId: 'p', at });
    const b = whatsappDedupeKey({ identity: { kind: 'session', token: 'x' }, productId: 'p', at });
    expect(a).not.toBe(b);
  });

  it('rolls to a new key the next day', () => {
    const a = whatsappDedupeKey({ identity: { kind: 'customer', id: 'c' }, productId: 'p', at });
    const b = whatsappDedupeKey({
      identity: { kind: 'customer', id: 'c' }, productId: 'p',
      at: new Date('2026-08-23T10:00:00Z'),
    });
    expect(a).not.toBe(b);
  });

  it('gives the site-wide chat button its own slot', () => {
    // Otherwise the floating button would collide with whichever product page
    // it happened to be clicked from.
    const site = whatsappDedupeKey({ identity: { kind: 'customer', id: 'c' }, productId: null, at });
    const product = whatsappDedupeKey({ identity: { kind: 'customer', id: 'c' }, productId: 'p', at });
    expect(site).not.toBe(product);
    expect(site).toContain(':site:');
  });

  it('cannot collide with an abandoned-cart key', () => {
    expect(whatsappDedupeKey({ identity: { kind: 'customer', id: 'c' }, productId: 'p', at }))
      .not.toBe(cartDedupeKey('c'));
  });
});

describe('the abandoned-cart key', () => {
  it('is one per cart, for ever', () => {
    // Not per day: the reminder campaign already runs on a schedule, and a
    // second lead would have sales chase one shopper twice.
    expect(cartDedupeKey('cart-1')).toBe(cartDedupeKey('cart-1'));
    expect(cartDedupeKey('cart-1')).not.toBe(cartDedupeKey('cart-2'));
  });
});

describe('the note left on the lead', () => {
  it('names the piece when there is one', () => {
    expect(whatsappNote('Kundan Polki Necklace')).toContain('Kundan Polki Necklace');
  });

  it('reads sensibly for the site-wide button', () => {
    expect(whatsappNote(null)).toBe('Started a WhatsApp chat from the site.');
  });

  it('gets the singular right for a one-item bag', () => {
    expect(abandonedCartNote(1, null)).toBe('Left 1 item in the bag.');
    expect(abandonedCartNote(3, null)).toBe('Left 3 items in the bag.');
  });

  it('includes the value when one could be worked out', () => {
    expect(abandonedCartNote(2, '₹1,24,300.00')).toContain('₹1,24,300.00');
  });
});

describe('how an anonymous lead reads in the CRM', () => {
  it('labels an enquiry with no name', () => {
    // An empty cell looks like a bug; this says what actually happened.
    expect(leadTitle({ name: null, source: 'WHATSAPP' })).toBe('Anonymous enquiry');
    expect(leadTitle({ name: null, source: 'ABANDONED_CART' })).toBe('Abandoned bag');
  });

  it('prefers a real name whenever there is one', () => {
    expect(leadTitle({ name: 'Ananya Sharma', source: 'WHATSAPP' })).toBe('Ananya Sharma');
  });

  it('treats a blank name as no name', () => {
    expect(leadTitle({ name: '   ', source: 'WHATSAPP' })).toBe('Anonymous enquiry');
  });

  it('says why a lead cannot be contacted rather than showing an empty line', () => {
    expect(leadContact({ phone: null, email: null })).toMatch(/not messaged yet/);
    expect(isUnreachable({ phone: null, email: null })).toBe(true);
  });

  it('shows whichever details exist', () => {
    expect(leadContact({ phone: '+919810000000', email: null })).toBe('+919810000000');
    expect(leadContact({ phone: null, email: 'a@b.co' })).toBe('a@b.co');
    expect(leadContact({ phone: '+919810000000', email: 'a@b.co' })).toBe('+919810000000 · a@b.co');
    expect(isUnreachable({ phone: null, email: 'a@b.co' })).toBe(false);
  });
});
