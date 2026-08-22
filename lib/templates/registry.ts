/**
 * The catalogue of emails this shop sends.
 *
 * Every key here ships with working copy. A `MessageTemplate` row is an
 * *override* of that copy, never the only copy — so a missing row, an inactive
 * row, or a row someone emptied out still results in a sent email. A silent
 * non-send on `order_confirmation` is worse than an unstyled one.
 *
 * The variable list per key is a **closed whitelist**. It is what the admin
 * editor offers, what the renderer will substitute, and what save-time
 * validation checks against. Adding a variable is a code change, deliberately:
 * it is the only place that decides what customer data may reach a template.
 *
 * Pure — no database, no `server-only` — so the whole catalogue is testable.
 */

import type { TemplateVariable } from '@/lib/templates/render';

export type TemplateKey =
  | 'order_confirmation'
  | 'payment_confirmation'
  | 'abandoned_cart'
  | 'birthday'
  | 'anniversary'
  | 'appointment_confirmation';

export type TemplateDefinition = {
  key: TemplateKey;
  /** Label in the admin list. */
  name: string;
  /** When this email is sent, in the operator's terms. */
  description: string;
  /** Transactional emails cannot be switched off; marketing ones can. */
  transactional: boolean;
  variables: TemplateVariable[];
  defaultSubject: string;
  defaultBodyHtml: string;
};

/** Available in every template, so the operator never has to hardcode the shop. */
const COMMON: TemplateVariable[] = [
  { name: 'brand', description: 'Your shop name', sample: 'Maya Jewellers' },
  { name: 'name', description: "The customer's name", sample: 'Ananya Sharma' },
  { name: 'store_phone', description: 'Shop phone number', sample: '+91 98100 00000' },
  { name: 'store_email', description: 'Shop email address', sample: 'hello@mayajewellers.in' },
  { name: 'site_url', description: 'Your website address', sample: 'https://mayajewellers.in' },
];

/** The brand heading every default body opens with. */
const HEADING = '<h2 style="font-family:Georgia,serif;color:#17362C">{{brand}}</h2>';

/** The rate note that closes the transactional emails. */
const RATE_NOTE =
  '<p style="color:#5F5950;font-size:12px;margin-top:24px">Prices reflect the metal rate locked at purchase.</p>';

export const TEMPLATES: TemplateDefinition[] = [
  {
    key: 'order_confirmation',
    name: 'Order confirmation',
    description: 'Sent the moment an order is placed, before payment clears.',
    transactional: true,
    variables: [
      ...COMMON,
      { name: 'order_number', description: 'Order reference', sample: 'MJ-2026-0142' },
      { name: 'order_total', description: 'Grand total, formatted', sample: '₹1,24,300.00' },
      { name: 'payment_method', description: 'How the customer chose to pay', sample: 'RAZORPAY' },
      { name: 'order_url', description: 'Link to the order in their account', sample: 'https://mayajewellers.in/account/orders' },
      {
        name: 'items_table',
        description: 'The list of items ordered, with prices (built for you — cannot be edited)',
        sample:
          '<tr><td style="padding:4px 0">Kundan Polki Necklace × 1</td><td align="right">₹1,24,300.00</td></tr>',
        html: true,
      },
    ],
    defaultSubject: 'Order confirmed — {{order_number}}',
    defaultBodyHtml: `${HEADING}
<h3>Your order is confirmed</h3>
<p>Hi {{name}}, thank you for your order <strong>{{order_number}}</strong>.</p>
<table style="width:100%;border-collapse:collapse;margin:12px 0">{{items_table}}
  <tr><td style="padding-top:8px;border-top:1px solid #E4DED4"><strong>Total</strong></td>
      <td align="right" style="padding-top:8px;border-top:1px solid #E4DED4"><strong>{{order_total}}</strong></td></tr>
  <tr><td>Payment</td><td align="right">{{payment_method}}</td></tr>
</table>
${RATE_NOTE}`,
  },
  {
    key: 'payment_confirmation',
    name: 'Payment received',
    description: 'Sent when a payment clears against an order.',
    transactional: true,
    variables: [
      ...COMMON,
      { name: 'order_number', description: 'Order reference', sample: 'MJ-2026-0142' },
      { name: 'amount_paid', description: 'Amount received, formatted', sample: '₹1,24,300.00' },
      { name: 'order_url', description: 'Link to the order in their account', sample: 'https://mayajewellers.in/account/orders' },
    ],
    defaultSubject: 'Payment received — {{order_number}}',
    defaultBodyHtml: `${HEADING}
<h3>Payment received</h3>
<p>We’ve received {{amount_paid}} for order <strong>{{order_number}}</strong>.</p>
${RATE_NOTE}`,
  },
  {
    key: 'abandoned_cart',
    name: 'Abandoned cart reminder',
    description: 'Sent in stages to shoppers who left items in their bag.',
    transactional: false,
    variables: [
      ...COMMON,
      { name: 'product', description: 'The first item left in the bag', sample: 'Kundan Polki Necklace' },
      { name: 'price', description: 'That item’s price, formatted', sample: '₹1,24,300.00' },
      { name: 'url', description: 'Link back to their bag', sample: 'https://mayajewellers.in/cart' },
      { name: 'stage', description: 'Which reminder this is', sample: 'Reminder 1' },
    ],
    defaultSubject: 'You left something behind — {{brand}}',
    defaultBodyHtml: `${HEADING}
<p>Hi {{name}}, you left <strong>{{product}}</strong> in your bag.</p>
<p>Prices move with the daily metal rate — complete your order to secure today’s price.</p>
<p><a href="{{url}}" style="color:#A8813C">Return to your bag</a></p>`,
  },
  {
    key: 'birthday',
    name: 'Birthday greeting',
    description: 'Sent on a customer’s birthday, if they opted into marketing.',
    transactional: false,
    variables: COMMON,
    defaultSubject: 'Happy birthday from {{brand}}',
    defaultBodyHtml: `${HEADING}
<p>Happy birthday, {{name}}! Wishing you a wonderful year ahead.</p>`,
  },
  {
    key: 'anniversary',
    name: 'Anniversary greeting',
    description: 'Sent on a customer’s anniversary, if they opted into marketing.',
    transactional: false,
    variables: COMMON,
    defaultSubject: 'Happy anniversary from {{brand}}',
    defaultBodyHtml: `${HEADING}
<p>Happy anniversary, {{name}}! Celebrate with something timeless.</p>`,
  },
  {
    key: 'appointment_confirmation',
    name: 'Appointment requested',
    description: 'Sent when someone books a showroom visit or video consultation.',
    transactional: true,
    variables: [
      ...COMMON,
      { name: 'appointment_type', description: 'Showroom visit or video consultation', sample: 'video consultation' },
      { name: 'appointment_date', description: 'The requested date', sample: 'Sat Aug 30 2026' },
      { name: 'appointment_slot', description: 'The requested time slot', sample: '11:00 AM' },
    ],
    defaultSubject: 'Appointment requested — {{brand}}',
    defaultBodyHtml: `${HEADING}
<p>Hi {{name}}, we’ve received your {{appointment_type}} request for
<strong>{{appointment_date}}</strong> at <strong>{{appointment_slot}}</strong>.</p>
<p>Our team will confirm shortly — or call us on {{store_phone}}.</p>`,
  },
];

const BY_KEY = new Map<string, TemplateDefinition>(TEMPLATES.map((t) => [t.key, t]));

export function templateDefinition(key: string): TemplateDefinition | null {
  return BY_KEY.get(key) ?? null;
}

export function isTemplateKey(key: string): key is TemplateKey {
  return BY_KEY.has(key);
}

/** Sample values for the preview and the test send, keyed by variable name. */
export function sampleValues(definition: TemplateDefinition): Record<string, string> {
  return Object.fromEntries(definition.variables.map((v) => [v.name, v.sample]));
}

/**
 * The outer frame every email is rendered into.
 *
 * Structure only — no words. Everything a customer reads lives in the template
 * body, so an operator can change any of it without a code edit.
 */
export function wrapEmail(inner: string): string {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#161513">${inner}</div>`;
}
