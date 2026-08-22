/**
 * How a lead reads in the CRM when the shop does not know who it is yet.
 *
 * Automatically captured enquiries have no name and no number — a WhatsApp
 * click-to-chat link never reveals either. Rendering an empty cell would look
 * like a bug; inventing a placeholder number would put an uncallable row in a
 * list of people to call. So both are labelled honestly, and the label says what
 * the shop can actually do about it.
 *
 * Pure, so the wording is unit-testable and lives in one place.
 */

export type LeadIdentity = {
  name: string | null;
  phone: string | null;
  email: string | null;
  source: string;
};

/** Title for a lead — their name, or what they did. */
export function leadTitle(lead: Pick<LeadIdentity, 'name' | 'source'>): string {
  if (lead.name?.trim()) return lead.name;
  return lead.source === 'ABANDONED_CART' ? 'Abandoned bag' : 'Anonymous enquiry';
}

/** Sub-line under the title: how to reach them, or why you cannot. */
export function leadContact(lead: Pick<LeadIdentity, 'phone' | 'email'>): string {
  const parts = [lead.phone, lead.email].filter((v): v is string => Boolean(v?.trim()));
  if (parts.length > 0) return parts.join(' · ');
  return 'No contact details — they have not messaged yet';
}

/** True when nobody can act on this lead by phone or email. */
export function isUnreachable(lead: Pick<LeadIdentity, 'phone' | 'email'>): boolean {
  return !lead.phone?.trim() && !lead.email?.trim();
}
