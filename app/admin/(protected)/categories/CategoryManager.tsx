'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import ImageUploadField from '@/components/admin/ImageUploadField';
import SeoPanel from '@/components/admin/SeoPanel';
import { createCategoryAction, updateCategoryAction, deleteCategoryAction } from './actions';

export type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  order: number;
  isActive: boolean;
  parentId: string | null;
  parentName: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
  productCount: number;
  childCount: number;
};

export default function CategoryManager({ categories }: { categories: CategoryRow[] }) {
  return (
    <div className="grid lg:grid-cols-[380px_1fr] gap-6 items-start">
      <CreateForm categories={categories} />
      <CategoryList categories={categories} />
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block mb-1 text-xs text-ink-soft">{label}</span>
      {children}
      {hint && <span className="block mt-1 text-[11px] text-ink-soft">{hint}</span>}
    </label>
  );
}

const inputCls = 'w-full border border-line px-2 py-1.5 text-xs outline-none focus:border-brass bg-transparent';

function CreateForm({ categories }: { categories: CategoryRow[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(fd: FormData) {
    setMsg(null);
    start(async () => {
      const res = await createCategoryAction(fd);
      if (res.ok) {
        setMsg('Category created');
        router.refresh();
      } else {
        setMsg(res.error);
      }
    });
  }

  // Only top-level categories are offered as parents: the storefront menu is
  // two levels deep, so a third level would not be rendered anywhere.
  const parents = categories.filter((c) => !c.parentId);

  return (
    <section className="border border-line p-4">
      <h2 className="font-heading text-lg mb-3">New category</h2>
      <form action={submit} className="space-y-3">
        <Field label="Name">
          <input name="name" required maxLength={80} className={inputCls} placeholder="Necklaces" />
        </Field>
        <Field label="Slug" hint="Leave blank to generate from the name.">
          <input name="slug" maxLength={80} className={inputCls} placeholder="necklaces" />
        </Field>
        <Field label="Parent">
          <select name="parentId" className={inputCls} defaultValue="">
            <option value="">— none (top level) —</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
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
        <ImageUploadField name="imageUrl" label="Image" prefix="categories" altSourceNote="Described by the category name." />
        <Field label="Description">
          <textarea name="description" rows={2} maxLength={2000} className={inputCls} />
        </Field>
        <div className="sm:col-span-2">
          <SeoPanel prefix="categories" />
        </div>
        <div className="flex items-center gap-3">
          <button disabled={pending} className="btn-primary text-xs">
            {pending ? 'Creating…' : 'Create category'}
          </button>
          {msg && <span className="text-xs text-ink-soft">{msg}</span>}
        </div>
      </form>
    </section>
  );
}

function CategoryList({ categories }: { categories: CategoryRow[] }) {
  if (categories.length === 0) {
    return (
      <section className="border border-line p-6 text-sm text-ink-soft">
        No categories yet. Create the first one on the left.
      </section>
    );
  }

  // Parents first, each followed by its own children, so the tree reads in the
  // same order the storefront menu renders it.
  const tops = categories.filter((c) => !c.parentId).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const ordered: CategoryRow[] = [];
  for (const top of tops) {
    ordered.push(top);
    ordered.push(
      ...categories
        .filter((c) => c.parentId === top.id)
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    );
  }
  // Any child whose parent is missing from the list still needs to be shown.
  for (const c of categories) if (!ordered.includes(c)) ordered.push(c);

  return (
    <section className="border border-line divide-y divide-line">
      {ordered.map((c) => (
        <CategoryRowItem key={c.id} category={c} categories={categories} />
      ))}
    </section>
  );
}

function CategoryRowItem({ category, categories }: { category: CategoryRow; categories: CategoryRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  const parents = categories.filter((c) => !c.parentId && c.id !== category.id);

  function save(fd: FormData) {
    setMsg(null);
    start(async () => {
      const res = await updateCategoryAction(category.id, fd);
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
      const res = await deleteCategoryAction(category.id);
      if (res.ok) router.refresh();
      else {
        setMsg(res.error);
        setConfirming(false);
      }
    });
  }

  return (
    <div className={cn('px-4 py-3 text-sm', category.parentId && 'pl-10')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">
            {category.name}
            {category.parentName && <span className="text-ink-soft font-normal"> · under {category.parentName}</span>}
          </p>
          <p className="text-xs text-ink-soft">
            /c/{category.slug} · order {category.order} · {category.productCount} product(s)
            {category.childCount > 0 && ` · ${category.childCount} sub-categor${category.childCount === 1 ? 'y' : 'ies'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'text-xs px-2 py-0.5 border rounded-[2px]',
              category.isActive ? 'border-velvet text-velvet' : 'border-line text-ink-soft'
            )}
          >
            {category.isActive ? 'Active' : 'Hidden'}
          </span>
          <button onClick={() => setOpen((v) => !v)} className="btn-outline text-xs py-1 px-3">
            {open ? 'Close' : 'Edit'}
          </button>
        </div>
      </div>

      {open && (
        <form action={save} className="mt-3 grid sm:grid-cols-2 gap-3">
          <Field label="Name">
            <input name="name" required defaultValue={category.name} maxLength={80} className={inputCls} />
          </Field>
          <Field label="Slug" hint="Changing this changes the public URL.">
            <input name="slug" defaultValue={category.slug} maxLength={80} className={inputCls} />
          </Field>
          <Field label="Parent">
            <select name="parentId" className={inputCls} defaultValue={category.parentId ?? ''}>
              <option value="">— none (top level) —</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Order">
              <input name="order" type="number" min={0} max={9999} defaultValue={category.order} className={inputCls} />
            </Field>
            <Field label="Status">
              <select name="isActive" className={inputCls} defaultValue={category.isActive ? 'true' : 'false'}>
                <option value="true">Active</option>
                <option value="false">Hidden</option>
              </select>
            </Field>
          </div>
          <ImageUploadField name="imageUrl" label="Image" prefix="categories" defaultValue={category.imageUrl ?? ''} altSourceNote="Described by the category name." />
          <Field label="Description">
            <textarea name="description" rows={2} defaultValue={category.description ?? ''} maxLength={2000} className={inputCls} />
          </Field>
          <div className="sm:col-span-2">
            <SeoPanel
              prefix="categories"
              publicPath={`/c/${category.slug}`}
              isPublished={category.isActive}
              defaults={{
                seoTitle: category.seoTitle, seoDescription: category.seoDescription,
                ogImageUrl: category.ogImageUrl, canonicalUrl: category.canonicalUrl, noIndex: category.noIndex,
              }}
            />
          </div>

          <div className="sm:col-span-2 flex flex-wrap items-center gap-3 pt-1">
            <button disabled={pending} className="btn-primary text-xs">
              {pending ? 'Saving…' : 'Save changes'}
            </button>
            {!confirming ? (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="btn-outline text-xs py-1 px-3"
              >
                Delete
              </button>
            ) : (
              <span className="flex items-center gap-2 text-xs">
                Delete this category?
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
