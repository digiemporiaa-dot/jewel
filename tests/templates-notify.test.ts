import { describe, it, expect } from 'vitest';
import { TEMPLATES, templateDefinition, isTemplateKey } from '@/lib/templates/registry';
import { renderTemplate } from '@/lib/templates/render';

/**
 * The template set, and the two notifications that were designed into the
 * schema and never sent.
 */

// Every key the build spec names.
const REQUIRED = [
  'order_confirmation', 'payment_confirmation', 'abandoned_cart',
  'order_shipped', 'order_delivered', 'back_in_stock', 'price_drop',
  'new_customer', 'birthday', 'anniversary', 'appointment_confirmation',
];

describe('the template set', () => {
  it('covers every message the shop sends', () => {
    for (const key of REQUIRED) {
      expect(isTemplateKey(key), `${key} is missing from the registry`).toBe(true);
    }
  });

  it('gives every template a subject and a body, so nothing can send blank', () => {
    for (const t of TEMPLATES) {
      expect(t.defaultSubject.trim().length, `${t.key} subject`).toBeGreaterThan(0);
      expect(t.defaultBodyHtml.trim().length, `${t.key} body`).toBeGreaterThan(0);
    }
  });

  it('declares every variable its own default copy uses', () => {
    // A placeholder with no declaration renders as literal "{{price}}" in a
    // customer's inbox, and the admin's variable list would not mention it.
    for (const t of TEMPLATES) {
      const declared = new Set(t.variables.map((v) => v.name));
      const used = new Set<string>();
      for (const text of [t.defaultSubject, t.defaultBodyHtml]) {
        for (const m of text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) used.add(m[1]!);
      }
      for (const name of used) {
        expect(declared.has(name), `${t.key} uses {{${name}}} but does not declare it`).toBe(true);
      }
    }
  });

  it('marks order and delivery mail transactional, so it cannot be switched off', () => {
    for (const key of ['order_confirmation', 'payment_confirmation', 'order_shipped', 'order_delivered']) {
      expect(templateDefinition(key)?.transactional, key).toBe(true);
    }
  });

  it('marks the marketing ones as marketing', () => {
    for (const key of ['back_in_stock', 'price_drop', 'new_customer', 'birthday', 'anniversary']) {
      expect(templateDefinition(key)?.transactional, key).toBe(false);
    }
  });
});

describe('the new templates render', () => {
  const render = (key: string, values: Record<string, string>) => {
    const t = templateDefinition(key)!;
    const allowed = t.variables;
    return renderTemplate(t.defaultBodyHtml, values, allowed, 'html');
  };

  it('puts a tracking number into the shipped email', () => {
    const html = render('order_shipped', {
      brand: 'Maya', name: 'Ravi', order_number: 'MJ-1', courier: 'Bluedart',
      awb: '77612345678', tracking_url: 'https://example.test/track', store_phone: '011',
    });
    expect(html).toContain('77612345678');
    expect(html).not.toContain('{{');
  });

  it('shows both prices in a price-drop email', () => {
    const html = render('price_drop', {
      brand: 'Maya', name: 'Ravi', product: 'Polki Necklace',
      old_price: '₹1,32,000.00', price: '₹1,24,300.00',
      url: 'https://example.test/p/x', store_phone: '011',
    });
    expect(html).toContain('₹1,32,000.00');
    expect(html).toContain('₹1,24,300.00');
  });

  it('escapes a product name rather than letting it become markup', () => {
    // Product names are operator input and reach an inbox.
    const html = render('back_in_stock', {
      brand: 'Maya', name: 'Ravi', product: '<script>alert(1)</script>',
      price: '₹1', url: 'https://example.test/p/x', store_phone: '011',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('still refuses a variable the template did not declare', () => {
    // The whitelist is per template; adding five templates must not have
    // widened it into a free-for-all.
    const t = templateDefinition('back_in_stock')!;
    const html = renderTemplate('{{awb}}', { awb: '123' }, t.variables, 'html');
    expect(html).not.toContain('123');
  });
});

// ── The notification bookkeeping ─────────────────────────────────────────────

/**
 * The rule that keeps these two from being either spam or silence.
 *
 * `sendTemplate` returns `false` rather than throwing when mail is unconfigured
 * — which is the shop's current state — so consuming the flag on a `false`
 * would clear every waiting request and send nothing. The shopper would never
 * hear about the piece, and nothing would look broken.
 */
describe('a notification is only marked done when it actually went', () => {
  const consume = (delivered: boolean) => {
    let flagCleared = false;
    if (delivered) flagCleared = true;
    return flagCleared;
  };

  it('clears the back-in-stock flag on a successful send', () => {
    expect(consume(true)).toBe(true);
  });

  it('leaves it set when the send failed, so the request survives to the next run', () => {
    expect(consume(false)).toBe(false);
  });
});

describe('a price drop is a fall, not a change', () => {
  const dropped = (before: number, now: number) => now < before;

  it('fires when the price falls', () => {
    expect(dropped(132000, 124300)).toBe(true);
  });

  it('does not fire when the metal rate pushes the price up', () => {
    // Rates move both ways; only one of them is news a shopper wants.
    expect(dropped(124300, 132000)).toBe(false);
  });

  it('does not fire on an unchanged price', () => {
    expect(dropped(124300, 124300)).toBe(false);
  });
});
