'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import ImageUploadField from '@/components/admin/ImageUploadField';
import SeoPanel from '@/components/admin/SeoPanel';
import { createCollectionAction, updateCollectionAction, deleteCollectionAction } from './actions';

export type CollectionRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  order: number;
  isActive: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
  productCount: number;
};

const inputCls = 'w-full border border-line px-2 py-1.5 text-xs outline-none focus:border-brass bg-transparent';

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block mb-1 text-xs text-ink-soft">{label}</span>
      {children}
      {hint && <span className="block mt-1 text-[11px] text-ink-soft">{hint}</span>}
    </label>
  );
}

export default function CollectionManager({ collections }: { collections: CollectionRow[] }) {
  return (
    <div className="grid lg:grid-cols-[380px_1fr] gap-6 items-start">
      <CreateForm />
      <CollectionList collections={collections} />
    </div>
  );
}

function CreateForm() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(fd: FormData) {
    setMsg(null);
    start(async () => {
      const res = await createCollectionAction(fd);
      if (res.ok) {
        setMsg('Collection created');
        router.refresh();
      } else {
        setMsg(res.error);
      }
    });
  }

  return (
    <section className="border border-line p-4">
      <h2 className="font-heading text-lg mb-3">New collection</h2>
      <form action={submit} className="space-y-3">
        <Field label="Name">
          <input name="name" required maxLength={80} className={inputCls} placeholder="Bridal Edit 2026" />
        </Field>
        <Field label="Slug" hint="Leave blank to generate from the name.">
          <input name="slug" maxLength={80} className={inputCls} placeholder="bridal-edit-2026" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Order">
            <input name="order" type="number" min={0} max={9999} defaultValue={0} className={inputCls} />
          </Field>
          <Field label="Status">
            <select name="isActive" className={inputCls} defaultValue="true">
              <option value="true">Active</option>
              <option value="false">Hidden</option>
            </select>
          </Field>
        </div>
        <ImageUploadField name="imageUrl" label="Image" prefix="collections" altSourceNote="Described by the collection name." />
        <Field label="Description">
          <textarea name="description" rows={2} maxLength={2000} className={inputCls} />
        </Field>
        <div className="sm:col-span-2">
          <SeoPanel prefix="collections" />
        </div>
        <div className="flex items-center gap-3">
          <button disabled={pending} className="btn-primary text-xs">
            {pending ? 'Creating…' : 'Create collection'}
          </button>
          {msg && <span className="text-xs text-ink-soft">{msg}</span>}
        </div>
      </form>
    </section>
  );
}

function CollectionList({ collections }: { collections: CollectionRow[] }) {
  if (collections.length === 0) {
    return (
      <section className="border border-line p-6 text-sm text-ink-soft">
        No collections yet. Create the first one on the left.
      </section>
    );
  }
  return (
    <section className="border border-line divide-y divide-line">
      {collections.map((c) => (
        <CollectionRowItem key={c.id} collection={c} />
      ))}
    </section>
  );
}

function CollectionRowItem({ collection }: { collection: CollectionRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  function save(fd: FormData) {
    setMsg(null);
    start(async () => {
      const res = await updateCollectionAction(collection.id, fd);
      if (res.ok) {
        setMsg('Saved');
        setOpen(false);
        router.refresh();
      } else {
        setMsg(res.error);
      }
    });
  }

  function remove() {
    setMsg(null);
    start(async () => {
      const res = await deleteCollectionAction(collection.id);
      if (res.ok) router.refresh();
      else {
        setMsg(res.error);
        setConfirming(false);
      }
    });
  }

  return (
    <div className="px-4 py-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">{collection.name}</p>
          <p className="text-xs text-ink-soft">
            /collection/{collection.slug} · order {collection.order} · {collection.productCount} product(s)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'text-xs px-2 py-0.5 border rounded-[2px]',
              collection.isActive ? 'border-velvet text-velvet' : 'border-line text-ink-soft'
            )}
          >
            {collection.isActive ? 'Active' : 'Hidden'}
          </span>
          <button onClick={() => setOpen((v) => !v)} className="btn-outline text-xs py-1 px-3">
            {open ? 'Close' : 'Edit'}
          </button>
        </div>
      </div>

      {open && (
        <form action={save} className="mt-3 grid sm:grid-cols-2 gap-3">
          <Field label="Name">
            <input name="name" required defaultValue={collection.name} maxLength={80} className={inputCls} />
          </Field>
          <Field label="Slug" hint="Changing this changes the public URL.">
            <input name="slug" defaultValue={collection.slug} maxLength={80} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Order">
              <input name="order" type="number" min={0} max={9999} defaultValue={collection.order} className={inputCls} />
            </Field>
            <Field label="Status">
              <select name="isActive" className={inputCls} defaultValue={collection.isActive ? 'true' : 'false'}>
                <option value="true">Active</option>
                <option value="false">Hidden</option>
              </select>
            </Field>
          </div>
          <ImageUploadField name="imageUrl" label="Image" prefix="collections" defaultValue={collection.imageUrl ?? ''} altSourceNote="Described by the collection name." />
          <Field label="Description">
            <textarea name="description" rows={2} defaultValue={collection.description ?? ''} maxLength={2000} className={inputCls} />
          </Field>
          <div className="sm:col-span-2">
            <SeoPanel
              prefix="collections"
              publicPath={`/collection/${collection.slug}`}
              isPublished={collection.isActive}
              defaults={{
                seoTitle: collection.seoTitle, seoDescription: collection.seoDescription,
                ogImageUrl: collection.ogImageUrl, canonicalUrl: collection.canonicalUrl, noIndex: collection.noIndex,
              }}
            />
          </div>

          <div className="sm:col-span-2 flex flex-wrap items-center gap-3 pt-1">
            <button disabled={pending} className="btn-primary text-xs">
              {pending ? 'Saving…' : 'Save changes'}
            </button>
            {!confirming ? (
              <button type="button" onClick={() => setConfirming(true)} className="btn-outline text-xs py-1 px-3">
                Delete
              </button>
            ) : (
              <span className="flex items-center gap-2 text-xs">
                Delete this collection?
                <button type="button" onClick={remove} disabled={pending} className="btn-outline text-xs py-1 px-3">
                  Yes, delete
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="btn-outline text-xs py-1 px-3">
                  Cancel
                </button>
              </span>
            )}
            {msg && <span className="text-xs text-ink-soft">{msg}</span>}
          </div>
        </form>
      )}

      {!open && msg && <p className="mt-2 text-xs text-ink-soft">{msg}</p>}
    </div>
  );
}
