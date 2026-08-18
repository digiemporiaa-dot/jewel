import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyRazorpayWebhook } from '@/lib/payments/razorpay';
import { confirmPayment, markPaymentFailed } from '@/lib/orders';

export const dynamic = 'force-dynamic';

/**
 * Razorpay webhook. Signature-verified, idempotent and reprocessable (brief §18,
 * RULES 6 & 7). A WebhookEvent row is created BEFORE processing so a duplicate
 * delivery is never processed twice, and a failed one can be retried.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-razorpay-signature') ?? '';

  // 1. Verify signature — reject anything unsigned/tampered.
  if (!verifyRazorpayWebhook(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let payload: RazorpayWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as RazorpayWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventType = payload.event ?? 'unknown';
  const eventId =
    request.headers.get('x-razorpay-event-id') ??
    payload.payload?.payment?.entity?.id ??
    payload.payload?.refund?.entity?.id ??
    `${eventType}:${Date.now()}`;

  // 2. Idempotency: record the event before processing.
  const existing = await prisma.webhookEvent.findUnique({ where: { provider_eventId: { provider: 'razorpay', eventId } } });
  if (existing && existing.status === 'PROCESSED') {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const event = existing
    ? await prisma.webhookEvent.update({
        where: { id: existing.id },
        data: { status: 'PROCESSING', attempts: { increment: 1 }, signatureValid: true },
      })
    : await prisma.webhookEvent.create({
        data: { provider: 'razorpay', eventId, eventType, status: 'PROCESSING', signatureValid: true, payload: payload as unknown as object, attempts: 1 },
      });

  // 3. Process.
  try {
    await processEvent(eventType, payload);
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { status: 'PROCESSED', processedAt: new Date(), error: null } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'processing failed';
    // Keep FAILED so it can be reprocessed on redelivery.
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { status: 'FAILED', error: message } });
    console.error('[webhook:razorpay] processing failed', message);
    return NextResponse.json({ ok: false, error: 'Processing failed' }, { status: 500 });
  }
}

async function processEvent(eventType: string, payload: RazorpayWebhookPayload): Promise<void> {
  switch (eventType) {
    case 'payment.captured':
    case 'order.paid': {
      const entity = payload.payload?.payment?.entity;
      if (!entity) return;
      const orderId = await orderIdFromProviderOrder(entity.order_id);
      if (!orderId) return; // unknown order — recorded, nothing to do
      await confirmPayment({ orderId, providerPaymentId: entity.id, providerOrderId: entity.order_id, source: 'webhook' });
      return;
    }
    case 'payment.failed': {
      const entity = payload.payload?.payment?.entity;
      if (!entity) return;
      const orderId = await orderIdFromProviderOrder(entity.order_id);
      if (orderId) await markPaymentFailed(orderId, entity.error_description ?? 'payment.failed');
      return;
    }
    case 'refund.processed': {
      const entity = payload.payload?.refund?.entity;
      if (!entity) return;
      const payment = await prisma.payment.findFirst({ where: { providerPaymentId: entity.payment_id } });
      if (!payment) return;
      await prisma.refund.upsert({
        where: { id: entity.id },
        create: { id: entity.id, orderId: payment.orderId, paymentId: payment.id, amount: (entity.amount / 100).toFixed(2), status: 'PROCESSED', providerRefundId: entity.id },
        update: { status: 'PROCESSED' },
      });
      await prisma.order.update({ where: { id: payment.orderId }, data: { paymentStatus: 'REFUNDED', events: { create: { message: 'Refund processed', actor: 'webhook' } } } }).catch(() => {});
      return;
    }
    default:
      return; // recorded but not actioned
  }
}

async function orderIdFromProviderOrder(providerOrderId: string | undefined): Promise<string | null> {
  if (!providerOrderId) return null;
  const payment = await prisma.payment.findFirst({ where: { providerOrderId }, select: { orderId: true } });
  return payment?.orderId ?? null;
}

// ── Minimal Razorpay webhook payload typing ──────────────────────────────────
type RazorpayWebhookPayload = {
  event?: string;
  payload?: {
    payment?: { entity?: { id: string; order_id?: string; error_description?: string } };
    refund?: { entity?: { id: string; payment_id: string; amount: number } };
  };
};
