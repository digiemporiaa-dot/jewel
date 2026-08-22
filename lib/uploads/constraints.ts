/**
 * Upload rules shared by the browser and the server.
 *
 * Deliberately free of `server-only` and of any Node import: the same functions
 * run in the admin's browser (so a 9 MB photo is refused before it is uploaded
 * anywhere) and in the presign route (because a check that only runs in the
 * browser is not a check). Neither side gets its own copy of the numbers.
 */

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

/**
 * Where an upload is allowed to land in the bucket.
 *
 * A closed list rather than a free string. The object key is built as
 * `${prefix}/${uuid}.${ext}`, so an operator-supplied prefix is a path the
 * operator controls — `../` or a leading slash would write outside the folder
 * the shop expects. Nothing about the feature needs an open-ended value.
 */
export const UPLOAD_PREFIXES = ['products', 'cms', 'blog', 'categories', 'collections', 'brand', 'seo'] as const;
export type UploadPrefix = (typeof UPLOAD_PREFIXES)[number];

export function isUploadPrefix(value: unknown): value is UploadPrefix {
  return typeof value === 'string' && (UPLOAD_PREFIXES as readonly string[]).includes(value);
}

export function isAllowedImageType(value: unknown): value is AllowedImageType {
  return typeof value === 'string' && (ALLOWED_IMAGE_TYPES as readonly string[]).includes(value);
}

export const MAX_UPLOAD_LABEL = `${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB`;

export type UploadCheck = { ok: true } | { ok: false; error: string };

/** Type and size gate. Same verdict, same wording, both sides of the wire. */
export function checkUpload(file: { type: string; size: number }): UploadCheck {
  if (!isAllowedImageType(file.type)) {
    return { ok: false, error: 'Unsupported file type. Use JPEG, PNG, WebP or AVIF.' };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, error: 'That file is empty.' };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `File too large. Max ${MAX_UPLOAD_LABEL}.` };
  }
  return { ok: true };
}

/**
 * Whether a pasted address is safe to store in an image field.
 *
 * Paste-a-URL stays as a fallback for shops with no storage configured, so it
 * has to refuse the same things everything else does: `javascript:` and `data:`
 * URLs end up in a `src` attribute, which is an XSS vector wearing a picture
 * frame. Site-relative paths are allowed — `/og-default.jpg` is a legitimate
 * value that lives in `public/`.
 */
export function checkImageUrl(value: string): UploadCheck {
  const url = value.trim();
  if (url === '') return { ok: true }; // empty means "no image", which is fine
  if (url.length > 500) return { ok: false, error: 'That address is too long.' };
  if (url.startsWith('/')) {
    return url.startsWith('//')
      ? { ok: false, error: 'Enter a full https:// address or a path beginning with a single /.' }
      : { ok: true };
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { ok: false, error: 'Only https:// addresses are accepted.' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Enter a full https:// address, or a path beginning with /.' };
  }
}

/** Human-readable size, for telling an operator why their file was refused. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
