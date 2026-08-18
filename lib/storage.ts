import 'server-only';
import { S3Client } from '@aws-sdk/client-s3';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

/**
 * S3-compatible storage (Cloudflare R2). Images are NEVER stored in Postgres
 * (brief §46). Uploads use presigned PUT URLs: the server validates the request,
 * returns a short-lived URL, and the browser uploads directly.
 */

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

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
  if (!ALLOWED_IMAGE_TYPES.includes(params.contentType as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    return { ok: false, error: 'Unsupported file type. Use JPEG, PNG, WebP or AVIF.' };
  }
  if (!Number.isFinite(params.size) || params.size <= 0 || params.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `File too large. Max ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.` };
  }
  if (!isStorageConfigured()) {
    return { ok: false, error: 'Storage is not configured. Add image by URL, or set R2_* env vars.' };
  }

  const ext = EXT[params.contentType] ?? 'bin';
  const key = `${params.prefix ?? 'products'}/${randomUUID()}.${ext}`;

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
