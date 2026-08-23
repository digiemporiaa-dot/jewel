import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CAMPAIGNS, campaignDefinition, hasSchedule } from '@/lib/campaigns/registry';
import { TEMPLATES } from '@/lib/templates/registry';

describe('campaign registry', () => {
  it('has no duplicate types', () => {
    const types = CAMPAIGNS.map((c) => c.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it('every campaign points at a template that exists', () => {
    const keys = new Set(TEMPLATES.map((t) => t.key));
    for (const campaign of CAMPAIGNS) {
      expect(keys.has(campaign.templateKey), `${campaign.type} → ${campaign.templateKey}`).toBe(true);
    }
  });

  it('describes every campaign in the operator\'s language', () => {
    for (const c of CAMPAIGNS) {
      expect(c.description.length, c.type).toBeGreaterThan(20);
      expect(c.trigger.when.length, c.type).toBeGreaterThan(3);
      if (c.trigger.kind === 'scheduled') expect(c.trigger.endpoint).toMatch(/^\/api\/cron\//);
    }
  });

  it('offers timing controls only where the code reads them', () => {
    // The abandoned-cart config is the only one `reminderConfig` consumes.
    // Showing delay fields on a campaign nothing reads them for would be the
    // same lie the switches used to tell.
    for (const c of CAMPAIGNS) {
      expect(hasSchedule(c.type), c.type).toBe(c.type === 'ABANDONED_CART');
    }
  });

  it('looks up by type and returns undefined for an unknown one', () => {
    expect(campaignDefinition('BIRTHDAY')?.templateKey).toBe('birthday');
    expect(campaignDefinition('NOT_A_CAMPAIGN')).toBeUndefined();
  });
});

/**
 * The regression this whole change exists for.
 *
 * Seven switches shipped and only three were connected: turning "New customer
 * welcome" off wrote a row, said "Saved", and the email went out anyway. A
 * control that lies is worse than a missing one, because the operator stops
 * looking.
 *
 * These read the senders as source rather than executing them — the modules are
 * `server-only` and pull in Prisma — so the assertion is exactly "somebody
 * consults this switch", which is the property that was missing.
 */
describe('every switch is actually wired', () => {
  const SOURCES = [
    'lib/campaigns/index.ts',
    'lib/email/notifications.ts',
    'lib/wishlist/notify.ts',
  ].map((f) => readFileSync(f, 'utf8')).join('\n');

  it.each(CAMPAIGNS.map((c) => c.type))('%s is checked before sending', (type) => {
    expect(SOURCES).toContain(`'${type}'`);
  });

  it('the four that were dead are guarded by isCampaignEnabled', () => {
    for (const type of ['NEW_CUSTOMER', 'BACK_IN_STOCK', 'PRICE_DROP', 'ORDER_UPDATE']) {
      expect(SOURCES).toContain(`isCampaignEnabled('${type}')`);
    }
  });
});
