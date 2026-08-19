import 'server-only';
import { prisma } from '@/lib/prisma';
import { ReviewStatus, OrderStatus } from '@prisma/client';

export class ReviewError extends Error {}

// A purchase counts once the order has actually reached the customer.
const FULFILLED: OrderStatus[] = [OrderStatus.DELIVERED, OrderStatus.OUT_FOR_DELIVERY, OrderStatus.SHIPPED];

/**
 * Find the customer's fulfilled order containing this product, if any.
 * Reviews are only accepted for products the customer actually bought (brief §24).
 */
export async function findPurchaseOrder(customerId: string, productId: string): Promise<string | null> {
  const order = await prisma.order.findFirst({
    where: { customerId, status: { in: FULFILLED }, items: { some: { productId } } },
    orderBy: { placedAt: 'desc' },
    select: { id: true },
  });
  return order?.id ?? null;
}

export async function canReview(customerId: string | null, productId: string): Promise<{ allowed: boolean; reason?: string; orderId?: string }> {
  if (!customerId) return { allowed: false, reason: 'Sign in to review a purchase' };
  const orderId = await findPurchaseOrder(customerId, productId);
  if (!orderId) return { allowed: false, reason: 'Only verified purchases can be reviewed' };
  const existing = await prisma.review.findFirst({ where: { customerId, productId } });
  if (existing) return { allowed: false, reason: 'You have already reviewed this piece' };
  return { allowed: true, orderId };
}

export async function submitReview(input: {
  customerId: string;
  productId: string;
  rating: number;
  title?: string | null;
  body?: string | null;
}): Promise<{ id: string }> {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    throw new ReviewError('Rating must be between 1 and 5');
  }
  // Re-verify server-side — never trust the client's claim of a purchase.
  const check = await canReview(input.customerId, input.productId);
  if (!check.allowed || !check.orderId) throw new ReviewError(check.reason ?? 'Cannot review this product');

  const review = await prisma.review.create({
    data: {
      productId: input.productId,
      customerId: input.customerId,
      orderId: check.orderId,
      rating: input.rating,
      title: input.title || null,
      body: input.body || null,
      verifiedPurchase: true,
      status: ReviewStatus.PENDING, // requires admin approval before display
    },
  });
  return { id: review.id };
}

/** Approved reviews for the product page. */
export async function getApprovedReviews(productId: string, limit = 10) {
  const reviews = await prisma.review.findMany({
    where: { productId, status: ReviewStatus.APPROVED },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { customer: { select: { name: true } } },
  });
  return reviews.map((r) => ({
    id: r.id,
    rating: r.rating,
    title: r.title,
    body: r.body,
    verifiedPurchase: r.verifiedPurchase,
    authorName: r.customer?.name ?? 'Verified buyer',
    createdAt: r.createdAt,
  }));
}

// ── Admin moderation ─────────────────────────────────────────────────────────

export async function listReviewsForModeration(status?: ReviewStatus) {
  return prisma.review.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      product: { select: { name: true, slug: true } },
      customer: { select: { name: true, phone: true } },
    },
  });
}

export async function moderateReview(reviewId: string, status: ReviewStatus, approverId: string): Promise<void> {
  await prisma.review.update({
    where: { id: reviewId },
    data: { status, approvedById: status === ReviewStatus.APPROVED ? approverId : null },
  });
}

export async function getReviewCounts(): Promise<Record<ReviewStatus, number>> {
  const rows = await prisma.review.groupBy({ by: ['status'], _count: true });
  const base = Object.fromEntries(Object.values(ReviewStatus).map((s) => [s, 0])) as Record<ReviewStatus, number>;
  for (const r of rows) base[r.status] = r._count;
  return base;
}
