'use client';

import { useState, useTransition, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import { addImageAction, deleteImageAction, setPrimaryImageAction, moveImageAction } from './actions';

type Image = { id: string; url: string; alt: string | null; isPrimary: boolean; order: number; device: string; type: string };

export default function ImageManager({ productId, images }: { productId: string; images: Image[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function addByUrl(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = await addImageAction(fd);
      setMsg(res.ok ? 'Image added' : res.error ?? 'Failed');
      if (res.ok) { (e.target as HTMLFormElement).reset(); router.refresh(); }
    });
  }

  // Presigned direct upload (R2). Falls back to a clear message if not configured.
  async function upload(file: File) {
    setMsg(null);
    setUploading(true);
    try {
      const presign = await fetch('/api/admin/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: file.type, size: file.size, prefix: 'products' }),
      });
      const data = await presign.json();
      if (!presign.ok) { setMsg(data.error ?? 'Upload not available'); return; }
      const put = await fetch(data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!put.ok) { setMsg('Upload failed'); return; }
      const fd = new FormData();
      fd.set('productId', productId);
      fd.set('url', data.publicUrl);
      fd.set('alt', file.name);
      const res = await addImageAction(fd);
      setMsg(res.ok ? 'Uploaded' : res.error ?? 'Failed');
      if (res.ok) router.refresh();
    } catch {
      setMsg('Upload error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    start(async () => {
      const res = await fn();
      if (!res.ok) setMsg(res.error ?? 'Failed'); else router.refresh();
    });
  }

  return (
    <div className="border border-line bg-white">
      <div className="px-5 py-3 border-b border-line"><h2 className="font-heading text-lg">Images</h2></div>

      <div className="p-5 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Add by URL */}
          <form onSubmit={addByUrl} className="border border-line p-3 space-y-2">
            <p className="text-xs text-ink-soft">Add by URL</p>
            <input type="hidden" name="productId" value={productId} />
            <input name="url" required placeholder="https://…/image.jpg" className="i-inp" />
            <input name="alt" placeholder="Alt text" className="i-inp" />
            <div className="flex gap-2">
              <select name="device" className="i-inp"><option value="ALL">All</option><option value="DESKTOP">Desktop</option><option value="MOBILE">Mobile</option></select>
              <select name="type" className="i-inp"><option value="IMAGE">Image</option><option value="VIDEO">Video</option></select>
            </div>
            <button disabled={pending} className="btn-outline text-xs py-1.5">{pending ? '…' : 'Add image'}</button>
          </form>

          {/* Direct upload */}
          <div className="border border-line p-3 space-y-2">
            <p className="text-xs text-ink-soft">Upload file (presigned R2)</p>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
              className="text-xs"
            />
            <p className="text-xs text-ink-soft">{uploading ? 'Uploading…' : 'JPEG/PNG/WebP/AVIF, max 8 MB.'}</p>
          </div>
        </div>

        {msg && <p className="text-sm text-ink-soft">{msg}</p>}

        {/* Gallery */}
        {images.length === 0 ? (
          <p className="text-sm text-ink-soft">No images yet.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {images.map((img) => (
              <div key={img.id} className={cn('border p-2', img.isPrimary ? 'border-brass' : 'border-line')}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.alt ?? ''} className="w-full aspect-square object-cover bg-paper-2" onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.3'; }} />
                <div className="mt-1 flex items-center justify-between text-[0.7rem]">
                  <span className="text-ink-soft">#{img.order}{img.isPrimary ? ' · primary' : ''}</span>
                  <div className="flex gap-1">
                    <button title="Up" onClick={() => act(() => moveImageAction(img.id, productId, 'up'))} className="px-1 border border-line">↑</button>
                    <button title="Down" onClick={() => act(() => moveImageAction(img.id, productId, 'down'))} className="px-1 border border-line">↓</button>
                  </div>
                </div>
                <div className="mt-1 flex gap-1">
                  {!img.isPrimary && <button onClick={() => act(() => setPrimaryImageAction(img.id, productId))} className="text-[0.7rem] btn-outline py-0.5 px-1.5 flex-1">Primary</button>}
                  <button onClick={() => act(() => deleteImageAction(img.id, productId))} className="text-[0.7rem] btn-outline py-0.5 px-1.5">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <style>{`.i-inp{width:100%;border:1px solid var(--line);padding:.4rem .5rem;font-size:.8rem;outline:none}.i-inp:focus{border-color:var(--brass)}`}</style>
    </div>
  );
}
