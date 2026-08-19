'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { assertPermission } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { moderateReview } from '@/lib/reviews';
import { ReviewStatus } from '@prisma/client';

export async function moderateReviewAction(reviewId: string, status: string): Promise<{ ok: boolean; error?: string }> {
  const staff = await assertPermission('reviews.moderate');
  const parsed = z.nativeEnum(ReviewStatus).safeParse(status);
  if (!parsed.success) return { ok: false, error: 'Invalid status' };

  await moderateReview(reviewId, parsed.data, staff.id);
  await writeAudit({ userId: staff.id, action: 'REVIEW_MODERATE', entity: 'Review', entityId: reviewId, after: { status: parsed.data } });
  revalidatePath('/admin/reviews');
  return { ok: true };
}
