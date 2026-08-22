import 'server-only';
import { S3Client } from '@aws-sdk/client-s3';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import {
  ALLOWED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  checkUpload,
  isUploadPrefix,
  type UploadPrefix,
} from '@/lib/uploads/constraints';

/**
 * S3-compatible storage (Cloudflare R2). Images are NEVER stored in Postgres
 * (brief §46). Uploads use presigned PUT URLs: the server validates the request,
 * returns a short-lived URL, and the browser uploads directly.
 */

// The limits themselves live in `lib/uploads/constraints.ts`, which the admin's
// browser can import too — one set of numbers, enforced on both sides.
export { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES };

export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.R2_ENDPOINT &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET
  );
}

let client: S3Client | null = null;
function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return client;
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

export type PresignResult =
  | { ok: true; uploadUrl: string; publicUrl: string; key: string }
  | { ok: false; error: string };

/**
 * Validate a requested upload and return a presigned PUT URL plus the eventual
 * public URL. Rejects disallowed MIME types and oversized files.
 */
export async function createPresignedUpload(params: {
  contentType: string;
  size: number;
  prefix?: string;
}): Promise<PresignResult> {
  const check = checkUpload({ type: params.contentType, size: params.size });
  if (!check.ok) return { ok: false, error: check.error };
  // The browser sends the prefix, so the browser does not get to choose the
  // path. Anything outside the closed list falls back to the default folder
  // rather than being interpolated into the object key.
  const prefix: UploadPrefix = isUploadPrefix(params.prefix) ? params.prefix : 'products';
  if (!isStorageConfigured()) {
    return { ok: false, error: 'Storage is not configured. Add image by URL, or set R2_* env vars.' };
  }

  const ext = EXT[params.contentType] ?? 'bin';
  const key = `${prefix}/${randomUUID()}.${ext}`;

  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    ContentType: params.contentType,
    ContentLength: params.size,
  });

  const uploadUrl = await getSignedUrl(getClient(), command, { expiresIn: 300 });
  const base = (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '');
  const publicUrl = `${base}/${key}`;
  return { ok: true, uploadUrl, publicUrl, key };
}
