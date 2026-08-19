'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createPostAction, updatePostAction, deletePostAction } from './actions';

export type PostDefaults = {
  id?: string; title?: string; slug?: string; author?: string; category?: string; tags?: string;
  featuredImage?: string; excerpt?: string; content?: string; status?: string; publishedAt?: string;
  seoTitle?: string; seoDescription?: string;
};

export default function PostForm({ defaults = {} }: { defaults?: PostDefaults }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setMsg(null);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = defaults.id ? await updatePostAction(defaults.id, fd) : await createPostAction(fd);
      if (res?.ok) { setMsg('Saved'); router.refresh(); }
      else if (res) setError(res.error ?? 'Failed');
    });
  }

  return (
    <form onSubmit={submit} className="border border-line bg-white p-5 space-y-3 text-sm">
      <div className="grid sm:grid-cols-2 gap-3">
        <L label="Title"><input name="title" defaultValue={defaults.title} required className="p-inp" /></L>
        <L label="Slug"><input name="slug" defaultValue={defaults.slug} required placeholder="best-gold-jewellery-for-weddings" className="p-inp" /></L>
        <L label="Author"><input name="author" defaultValue={defaults.author ?? 'Maya Jewellers'} required className="p-inp" /></L>
        <L label="Category"><input name="category" defaultValue={defaults.category} className="p-inp" /></L>
        <L label="Tags (comma-separated)"><input name="tags" defaultValue={defaults.tags} className="p-inp" /></L>
        <L label="Featured image URL"><input name="featuredImage" defaultValue={defaults.featuredImage} className="p-inp" /></L>
        <L label="Status">
          <select name="status" defaultValue={defaults.status ?? 'DRAFT'} className="p-inp">
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
          </select>
        </L>
        <L label="Publish date"><input name="publishedAt" type="datetime-local" defaultValue={defaults.publishedAt} className="p-inp" /></L>
      </div>
      <L label="Excerpt"><textarea name="excerpt" defaultValue={defaults.excerpt} rows={2} className="p-inp" /></L>
      <L label="Content (one paragraph per line)"><textarea name="content" defaultValue={defaults.content} rows={12} required className="p-inp font-mono text-xs" /></L>
      <div className="grid sm:grid-cols-2 gap-3">
        <L label="SEO title"><input name="seoTitle" defaultValue={defaults.seoTitle} className="p-inp" /></L>
        <L label="SEO description"><input name="seoDescription" defaultValue={defaults.seoDescription} className="p-inp" /></L>
      </div>

      {error && <p className="text-xs text-red-700">{error}</p>}
      {msg && <p className="text-xs text-ink-soft">{msg}</p>}

      <div className="flex gap-2">
        <button disabled={pending} className="btn-primary text-xs">{pending ? 'Saving…' : defaults.id ? 'Save post' : 'Create post'}</button>
        {defaults.id && (
          <button type="button" disabled={pending} onClick={() => start(async () => { await deletePostAction(defaults.id!); })} className="btn-outline text-xs text-red-700 border-red-300">Delete</button>
        )}
      </div>
      <style>{`.p-inp{width:100%;border:1px solid var(--line);padding:.5rem .625rem;font-size:.875rem;outline:none}.p-inp:focus{border-color:var(--brass)}`}</style>
    </form>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block mb-1 text-xs text-ink-soft">{label}</span>{children}</label>;
}
