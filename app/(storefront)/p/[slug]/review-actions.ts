'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCustomerId } from '@/lib/customer-session';
import { submitReview, ReviewError } from '@/lib/reviews';
import { checkLimit, LIMITS } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-id';

const schema = z.object({
  productId: z.string().min(1),
  slug: z.string().min(1),
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional().or(z.literal('')),
  body: z.string().trim().max(2000).optional().or(z.literal('')),
});

export async function submitReviewAction(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid review' };

  const customerId = await getCustomerId();
  if (!customerId) return { ok: false, error: 'Please sign in to leave a review' };

  const rl = checkLimit(`review:${await getClientIp()}`, LIMITS.review);
  if (!rl.allowed) return { ok: false, error: 'Too many submissions. Please try again later.' };

  try {
    await submitReview({
      customerId,
      productId: parsed.data.productId,
      rating: parsed.data.rating,
      title: parsed.data.title || null,
      body: parsed.data.body || null,
    });
    revalidatePath(`/p/${parsed.data.slug}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof ReviewError ? e.message : 'Could not submit your review' };
  }
}
