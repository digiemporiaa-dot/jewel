import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { can } from '@/lib/auth/rbac';
import { createPresignedUpload, ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from '@/lib/storage';

export const dynamic = 'force-dynamic';

const schema = z.object({
  contentType: z.enum(ALLOWED_IMAGE_TYPES),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  prefix: z.string().max(40).optional(),
});

/**
 * Presigned-upload endpoint. Server-side authorization required (products.manage);
 * validates MIME and size before issuing a short-lived URL.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !can(session.user.role, 'products.manage')) {
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
