import 'server-only';
import { Prisma, LeadSource, LeadStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  whatsappDedupeKey, cartDedupeKey, whatsappNote, abandonedCartNote,
  type EnquiryIdentity,
} from '@/lib/leads/capture';

/**
 * Raising a lead from something the shopper did, rather than from a form they
 * filled in.
 *
 * Every function here is **best-effort and never throws**. A lead is a sales
 * convenience; losing one is a shame, but failing a WhatsApp click or an
 * abandoned-cart reminder because the CRM write failed would be worse.
 */

/** Postgres unique-violation. */
function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/**
 * Insert a lead, or record a repeat of the one already holding this key.
 *
 * Uniqueness is enforced by the index, not by a check-then-insert: two clicks
 * landing in the same millisecond would both pass a `findFirst` and both write.
 * So the insert is simply attempted, and a unique violation is the signal that
 * this is a repeat.
 */
async function upsertByDedupeKey(
  dedupeKey: string,
  create: Omit<Prisma.LeadUncheckedCreateInput, 'dedupeKey'>
): Promise<'created' | 'repeated' | 'failed'> {
  try {
    await prisma.lead.create({ data: { ...create, dedupeKey } });
    return 'created';
  } catch (e) {
    if (!isUniqueViolation(e)) {
      console.error('[leads] capture failed', dedupeKey, e);
      return 'failed';
    }
  }

  try {
    // A repeat is information, not noise: bump the count and the timestamp so
    // sales can see this shopper came back.
    await prisma.lead.update({
      where: { dedupeKey },
      data: { touchCount: { increment: 1 } },
    });
    return 'repeated';
  } catch (e) {
    console.error('[leads] repeat update failed', dedupeKey, e);
    return 'failed';
  }
}

export type WhatsAppEnquiryInput = {
  identity: EnquiryIdentity;
  productId: string | null;
  at?: Date;
};

/**
 * Record that someone opened a WhatsApp chat with the shop.
 *
 * Note what is *not* captured: a click-to-chat link never reveals the visitor's
 * phone number — that arrives when they send the message — so an anonymous
 * enquiry is stored with no name and no number. Inventing a placeholder number
 * would put an uncallable row in a list of people to call.
 */
export async function captureWhatsAppEnquiry(
  input: WhatsAppEnquiryInput
): Promise<'created' | 'repeated' | 'failed'> {
  const at = input.at ?? new Date();

  // Resolved *before* the key is built, and the key uses the resolved id rather
  // than the requested one. Otherwise a caller could mint a fresh lead per made
  // up product id and walk straight around the de-duplication; unresolvable ids
  // now collapse into that visitor's one site-level lead for the day.
  let productName: string | null = null;
  let product: { id: string } | null = null;
  if (input.productId) {
    product = await prisma.product
      .findFirst({ where: { id: input.productId, isActive: true }, select: { id: true, name: true } })
      .then((p) => { productName = p?.name ?? null; return p ? { id: p.id } : null; })
      .catch(() => null);
  }

  const key = whatsappDedupeKey({ identity: input.identity, productId: product?.id ?? null, at });

  const customerId = input.identity.kind === 'customer' ? input.identity.id : null;
  const customer = customerId
    ? await prisma.customer
        .findUnique({ where: { id: customerId }, select: { name: true, phone: true, email: true } })
        .catch(() => null)
    : null;

  return upsertByDedupeKey(key, {
    source: LeadSource.WHATSAPP,
    status: LeadStatus.NEW,
    name: customer?.name ?? null,
    phone: customer?.phone ?? null,
    email: customer?.email ?? null,
    customerId,
    productId: product?.id ?? null,
    sessionToken: input.identity.kind === 'session' ? input.identity.token : null,
    notes: whatsappNote(productName),
  });
}

export type AbandonedCartLeadInput = {
  cartId: string;
  customerId: string | null;
  sessionToken: string | null;
  itemCount: number;
  value: string | null;
  productId: string | null;
};

/**
 * Raise a lead for a cart that has been left behind.
 *
 * One per cart, ever — the reminder campaign already runs on its own schedule,
 * and a second lead for the same cart would have sales chase one shopper twice.
 */
export async function captureAbandonedCartLead(
  input: AbandonedCartLeadInput
): Promise<'created' | 'repeated' | 'failed'> {
  const customer = input.customerId
    ? await prisma.customer
        .findUnique({ where: { id: input.customerId }, select: { name: true, phone: true, email: true } })
        .catch(() => null)
    : null;

  return upsertByDedupeKey(cartDedupeKey(input.cartId), {
    source: LeadSource.ABANDONED_CART,
    status: LeadStatus.NEW,
    name: customer?.name ?? null,
    phone: customer?.phone ?? null,
    email: customer?.email ?? null,
    customerId: input.customerId,
    productId: input.productId,
    sessionToken: input.sessionToken,
    estimatedValue: input.value ?? undefined,
    notes: abandonedCartNote(input.itemCount, input.value),
  });
}
