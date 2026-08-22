'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import ImageUploadField from '@/components/admin/ImageUploadField';
import { addImageAction, deleteImageAction, setPrimaryImageAction, moveImageAction } from './actions';

type Image = { id: string; url: string; alt: string | null; isPrimary: boolean; order: number; device: string; type: string };

export default function ImageManager({ productId, images }: { productId: string; images: Image[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  // Held here rather than left to the DOM so the Add button can refuse an
  // unlabelled image before it reaches the server.
  const [url, setUrl] = useState('');
  const [alt, setAlt] = useState('');

  function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = await addImageAction(fd);
      setMsg(res.ok ? 'Image added' : res.error ?? 'Failed');
      if (res.ok) { setUrl(''); setAlt(''); router.refresh(); }
    });
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
        {/* One image field, one upload path. Upload to storage or paste a
            hosted address — both end up in the same input. */}
        <form onSubmit={add} className="border border-line p-3 space-y-3">
          <input type="hidden" name="productId" value={productId} />
          <ImageUploadField
            name="url"
            label="Image"
            prefix="products"
            value={url}
            onChange={setUrl}
            altName="alt"
            altValue={alt}
            onAltChange={setAlt}
            requireAlt
            required
          />
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-ink-soft">
              <span className="block mb-1">Shown on</span>
              <select name="device" className="i-inp"><option value="ALL">All devices</option><option value="DESKTOP">Desktop</option><option value="MOBILE">Mobile</option></select>
            </label>
            <label className="text-xs text-ink-soft">
              <span className="block mb-1">Type</span>
              <select name="type" className="i-inp"><option value="IMAGE">Image</option><option value="VIDEO">Video</option></select>
            </label>
            <button
              disabled={pending || url.trim() === '' || alt.trim() === ''}
              className="btn-outline text-xs py-1.5 disabled:opacity-50"
            >
              {pending ? '…' : 'Add image'}
            </button>
          </div>
        </form>

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
