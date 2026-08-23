import type { TemplateKey } from '@/lib/templates/registry';

/**
 * The catalogue of automated sends a shop can switch on and off.
 *
 * This exists because the campaigns screen was listing seven switches and only
 * three of them were connected to anything. Turning "New customer welcome" off
 * wrote a row, said "Saved", and the welcome email went out anyway. A control
 * that lies is worse than a missing one: the operator believes they have
 * stopped something and stops looking.
 *
 * So the list of campaigns lives here, next to the fact of which template each
 * one sends, and `lib/campaigns/index.ts` exposes one `isCampaignEnabled` check
 * that every sender calls. Adding a campaign means adding a row here and calling
 * that check — there is no way to add a switch without wiring it, because the
 * switch and the wiring are the same table.
 *
 * `templateKey` is also what makes the admin card openable: each campaign links
 * straight to the wording it sends, instead of leaving staff to guess which of
 * eleven templates belongs to which of seven switches.
 */

/** How a campaign is triggered. Staff need to know what to expect after saving. */
export type CampaignTrigger =
  /** Fires the moment the thing happens, inside the request that caused it. */
  | { kind: 'immediate'; when: string }
  /** Waits for a scheduled run. `endpoint` is the cron route that drives it. */
  | { kind: 'scheduled'; when: string; endpoint: string };

export type CampaignDefinition = {
  type: string;
  name: string;
  /** One line, in the operator's language, about when this reaches a customer. */
  description: string;
  templateKey: TemplateKey;
  trigger: CampaignTrigger;
  /**
   * Transactional sends are about an order the customer has already paid for.
   * They can still be switched off — a shop that confirms by WhatsApp has a real
   * reason to — but the card says plainly what switching it off costs.
   */
  transactional: boolean;
};

export const CAMPAIGNS: CampaignDefinition[] = [
  {
    type: 'ABANDONED_CART',
    name: 'Abandoned cart',
    description: 'Reminds a shopper who left something in their bag, up to three times.',
    templateKey: 'abandoned_cart',
    trigger: { kind: 'scheduled', when: 'On each scheduled run', endpoint: '/api/cron/abandoned-cart' },
    transactional: false,
  },
  {
    type: 'BIRTHDAY',
    name: 'Birthday greetings',
    description: "Sent on a customer's birthday, if they opted into marketing.",
    templateKey: 'birthday',
    trigger: { kind: 'scheduled', when: 'Once a day', endpoint: '/api/cron/campaigns' },
    transactional: false,
  },
  {
    type: 'ANNIVERSARY',
    name: 'Anniversary greetings',
    description: 'Sent on a stored anniversary date, if they opted into marketing.',
    templateKey: 'anniversary',
    trigger: { kind: 'scheduled', when: 'Once a day', endpoint: '/api/cron/campaigns' },
    transactional: false,
  },
  {
    type: 'NEW_CUSTOMER',
    name: 'New customer welcome',
    description: 'Greets a customer the first time they sign in, before their first order.',
    templateKey: 'new_customer',
    trigger: { kind: 'immediate', when: 'On first sign-in' },
    transactional: false,
  },
  {
    type: 'BACK_IN_STOCK',
    name: 'Back in stock',
    description: 'Tells shoppers a saved piece is available again. One email per shopper, per return.',
    templateKey: 'back_in_stock',
    trigger: { kind: 'immediate', when: 'When stock goes from zero to available' },
    transactional: false,
  },
  {
    type: 'PRICE_DROP',
    name: 'Price drop',
    description: 'Tells shoppers a saved piece now costs less than when they saved it.',
    templateKey: 'price_drop',
    trigger: { kind: 'scheduled', when: 'After each price recompute', endpoint: '/api/cron/recompute-prices' },
    transactional: false,
  },
  {
    type: 'ORDER_UPDATE',
    name: 'Order shipped & delivered',
    description: 'Tells a customer their parcel is on its way, and again when it arrives.',
    templateKey: 'order_shipped',
    trigger: { kind: 'immediate', when: 'When a shipment is dispatched or delivered' },
    transactional: true,
  },
];

export function campaignDefinition(type: string): CampaignDefinition | undefined {
  return CAMPAIGNS.find((c) => c.type === type);
}

/** Only the abandoned-cart campaign has timing an operator can change. */
export function hasSchedule(type: string): boolean {
  return type === 'ABANDONED_CART';
}
