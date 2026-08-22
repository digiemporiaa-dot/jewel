import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { captureWhatsAppEnquiry } from '@/lib/leads';
import { getCustomerId } from '@/lib/customer-session';
import { ensureSessionToken } from '@/lib/session';
import { checkLimit, LIMITS } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-id';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // Prisma — never Edge.

/**
 * "Someone opened a WhatsApp chat."
 *
 * Called by `navigator.sendBeacon` as the shopper leaves for WhatsApp, so it
 * must never delay or block that navigation. It returns 204 with no body: there
 * is nothing for the page to read, and a beacon response is discarded anyway.
 *
 * The browser supplies exactly one thing — which product page the click came
 * from — and even that is verified against the database before it is stored.
 * Who the shopper is comes from the server's own cookies, never from the
 * payload: a public endpoint that accepted a customer id would let anyone
 * attribute enquiries to anyone.
 */

const schema = z.object({
  // cuid — the only shape a product id can take here.
  productId: z.string().trim().regex(/^[a-z0-9]{20,40}$/i).nullable().optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Cheap and public, but still stateful, so it is limited like any other
  // public write. Failing the limit is silent — the shopper is already on their
  // way to WhatsApp and there is nothing useful to tell them.
  const limit = await checkLimit(`enquiry:${await getClientIp()}`, LIMITS.publicAction);
  if (!limit.allowed) return new NextResponse(null, { status: 204 });

  let productId: string | null = null;
  try {
    const parsed = schema.safeParse(await req.json());
    if (parsed.success) productId = parsed.data.productId ?? null;
  } catch {
    // A malformed beacon is not worth a 400 nobody will read.
  }

  const customerId = await getCustomerId();

  if (customerId) {
    await captureWhatsAppEnquiry({ identity: { kind: 'customer', id: customerId }, productId });
  } else {
    // Most WhatsApp enquiries come from visitors who never added anything to a
    // bag, so they have no session cookie yet. `ensureSessionToken` issues one
    // here — a beacon's response body is discarded by the page, but the browser
    // still applies its Set-Cookie — otherwise the first click from every new
    // visitor would be unattributable and the second would look like a first.
    //
    // Same first-party, httpOnly cookie the guest bag already uses; this adds no
    // new tracking surface.
    await captureWhatsAppEnquiry({
      identity: { kind: 'session', token: await ensureSessionToken() },
      productId,
    });
  }

  return new NextResponse(null, { status: 204 });
}
