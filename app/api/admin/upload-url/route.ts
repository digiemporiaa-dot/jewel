import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { canAny, type Permission } from '@/lib/auth/rbac';
import { createPresignedUpload } from '@/lib/storage';
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES, UPLOAD_PREFIXES } from '@/lib/uploads/constraints';

export const dynamic = 'force-dynamic';

/**
 * Anyone who can put an image on a screen needs to be able to upload one.
 *
 * This used to demand `products.manage`, which was right when the product
 * editor was the only uploader. Now the CMS, blog, categories, collections, SEO
 * and brand settings all use the same field, and a role that can edit a page but
 * not a product would have been sent to a dead end. It stays a closed list: a
 * dispatch user has no reason to write to the bucket.
 */
const UPLOAD_PERMISSIONS: Permission[] = [
  'products.manage',
  'categories.manage',
  'collections.manage',
  'cms.manage',
  'blog.manage',
  'settings.manage',
];

const schema = z.object({
  contentType: z.enum(ALLOWED_IMAGE_TYPES),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  // A closed list, not a free string: this value is interpolated into the
  // object key, so an open-ended one lets the caller choose the path.
  prefix: z.enum(UPLOAD_PREFIXES).optional(),
});

/**
 * Presigned-upload endpoint. Server-side authorization required; validates MIME
 * and size before issuing a short-lived URL.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !canAny(session.user.role, UPLOAD_PERMISSIONS)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
  }

  const result = await createPresignedUpload(parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}
