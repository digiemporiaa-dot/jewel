'use client';

import { useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils/cn';
import {
  ALLOWED_IMAGE_TYPES,
  MAX_UPLOAD_LABEL,
  checkImageUrl,
  checkUpload,
  formatBytes,
  type UploadPrefix,
} from '@/lib/uploads/constraints';

/**
 * The one image field in the admin.
 *
 * Every screen that stores an image address uses this — products, CMS blocks,
 * blog covers, category and collection art, the OG image, the logo and the
 * favicon. There is exactly one upload path in the application: this component
 * calls `/api/admin/upload-url` for a short-lived presigned PUT and sends the
 * file straight to storage. A second uploader would mean a second set of type
 * and size rules, and the second set is always the one that is out of date.
 *
 * Pasting a hosted address stays available. Storage is optional configuration —
 * a shop deployed without `R2_*` set must still be able to put a picture on a
 * page, and it is also how a photo already on a CDN gets used without a
 * pointless round trip through this bucket.
 */

type Props = {
  /** Form field name. The field is a real input, so plain `<form>` posts work. */
  name?: string;
  label: string;
  /** Uncontrolled initial value. */
  defaultValue?: string | null;
  /** Controlled value — pass with `onChange` for editors that hold their own state. */
  value?: string;
  onChange?: (url: string) => void;
  /** Which folder in the bucket. Closed list; the server re-checks it. */
  prefix: UploadPrefix;
  hint?: string;
  required?: boolean;
  className?: string;

  /** Alt text, where the model has somewhere to keep it. */
  altName?: string;
  altLabel?: string;
  altDefaultValue?: string | null;
  altValue?: string;
  onAltChange?: (alt: string) => void;
  /** Show alt as required. The parent still enforces it on submit. */
  requireAlt?: boolean;
  /**
   * Where the alt text comes from when this field has nowhere to store it —
   * e.g. a category image is described by the category's own name. Shown so an
   * operator is not left wondering whether the image is unlabelled.
   */
  altSourceNote?: string;
};

const ACCEPT = ALLOWED_IMAGE_TYPES.join(',');

export default function ImageUploadField({
  name, label, defaultValue, value, onChange, prefix, hint, required, className,
  altName, altLabel = 'Alt text', altDefaultValue, altValue, onAltChange, requireAlt, altSourceNote,
}: Props) {
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);

  const controlled = onChange !== undefined;
  const [internal, setInternal] = useState(defaultValue ?? '');
  const url = controlled ? value ?? '' : internal;

  const altControlled = onAltChange !== undefined;
  const [internalAlt, setInternalAlt] = useState(altDefaultValue ?? '');
  const alt = altControlled ? altValue ?? '' : internalAlt;

  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);

  function setUrl(next: string) {
    setBroken(false);
    if (controlled) onChange?.(next);
    else setInternal(next);
  }

  function setAlt(next: string) {
    if (altControlled) onAltChange?.(next);
    else setInternalAlt(next);
  }

  function onUrlTyped(next: string) {
    setUrl(next);
    const verdict = checkImageUrl(next);
    setError(verdict.ok ? null : verdict.error);
  }

  async function upload(file: File) {
    setError(null);
    setNote(null);

    // Checked here first so a 9 MB photo on a shop's connection is refused in
    // the same second rather than after it has been sent anywhere.
    const verdict = checkUpload({ type: file.type, size: file.size });
    if (!verdict.ok) {
      setError(`${verdict.error} (${file.name} is ${formatBytes(file.size)})`);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    setProgress(0);
    try {
      const presign = await fetch('/api/admin/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: file.type, size: file.size, prefix }),
      });
      const data: unknown = await presign.json().catch(() => null);
      const payload = (data ?? {}) as { uploadUrl?: string; publicUrl?: string; error?: string };
      if (!presign.ok || !payload.uploadUrl || !payload.publicUrl) {
        setError(payload.error ?? 'Upload is not available.');
        return;
      }

      await put(payload.uploadUrl, file, setProgress);
      setUrl(payload.publicUrl);
      setNote(`Uploaded ${file.name} (${formatBytes(file.size)}).`);
      if (requireAlt && alt.trim() === '') {
        setNote(`Uploaded ${file.name}. Add alt text below.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setProgress(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const altMissing = Boolean(requireAlt && altName && url.trim() !== '' && alt.trim() === '');

  return (
    <div className={cn('space-y-2', className)}>
      <label htmlFor={`${id}-url`} className="block text-xs text-ink-soft">
        {label}{required && <span aria-hidden="true"> *</span>}
      </label>

      <div className="flex gap-3">
        {/* Preview. A wrong or dead address is worth seeing before saving. */}
        <div className="h-20 w-20 shrink-0 border border-line bg-paper-2 grid place-items-center overflow-hidden">
          {url.trim() && !broken ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} />
          ) : (
            <span className="text-[0.65rem] text-ink-soft text-center px-1">
              {url.trim() ? 'Not loading' : 'No image'}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <input
            id={`${id}-url`}
            name={name}
            value={url}
            onChange={(e) => onUrlTyped(e.target.value)}
            placeholder="https://…/image.jpg  — or upload"
            maxLength={500}
            required={required}
            aria-describedby={`${id}-hint`}
            className="w-full border border-line px-2 py-1.5 text-sm outline-none focus:border-brass"
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={progress !== null}
              className="btn-outline text-xs py-1 px-2"
            >
              {progress !== null ? `Uploading ${progress}%` : 'Upload a file'}
            </button>
            {url.trim() && progress === null && (
              <button type="button" onClick={() => { setUrl(''); setError(null); setNote(null); }} className="text-xs underline decoration-line-strong underline-offset-4 hover:text-brass">
                Remove
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
            />
          </div>

          {progress !== null && (
            <div className="h-1 w-full bg-paper-2" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${label}`}>
              <div className="h-full bg-brass transition-[width] duration-150" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
      </div>

      {altName && (
        <label className="block">
          <span className="block mb-1 text-xs text-ink-soft">
            {altLabel}{requireAlt && <span aria-hidden="true"> *</span>}
          </span>
          <input
            name={altName}
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            maxLength={160}
            aria-invalid={altMissing || undefined}
            placeholder="What the picture shows, for screen readers and search"
            className={cn(
              'w-full border px-2 py-1.5 text-sm outline-none focus:border-brass',
              altMissing ? 'border-red-400' : 'border-line'
            )}
          />
        </label>
      )}

      {altMissing && (
        <p className="text-xs text-red-700">
          Alt text is required. Describe the piece — “22k gold jhumka with pearl drop”, not “image1.jpg”.
        </p>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
      {note && !error && <p className="text-xs text-ink-soft">{note}</p>}
      <p id={`${id}-hint`} className="text-xs text-ink-soft">
        {hint ? `${hint} ` : ''}JPEG, PNG, WebP or AVIF, up to {MAX_UPLOAD_LABEL}. You can also paste a hosted address.
        {altSourceNote ? ` ${altSourceNote}` : ''}
      </p>
    </div>
  );
}

/**
 * `fetch` reports no upload progress, so the PUT goes through XHR. On a shop's
 * connection an 8 MB photo is a slow, silent minute otherwise, and a silent
 * minute is when somebody clicks the button again.
 */
function put(uploadUrl: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Storage refused the upload (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error('Upload failed — check the connection and try again.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    xhr.send(file);
  });
}
