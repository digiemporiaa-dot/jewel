'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createPageAction, updatePageAction, deletePageAction } from './actions';

export type PageDefaults = {
  id?: string;
  title?: string; slug?: string; status?: string; scheduledAt?: string;
  seoTitle?: string; seoDescription?: string;
};

export default function PageForm({ defaults = {} }: { defaults?: PageDefaults }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [status, setStatus] = useState(defaults.status ?? 'DRAFT');

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setMsg(null);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = defaults.id ? await updatePageAction(defaults.id, fd) : await createPageAction(fd);
      if (res?.ok) { setMsg('Saved'); router.refresh(); }
      else if (res) setError(res.error ?? 'Failed');
    });
  }

  function remove() {
    if (!defaults.id) return;
    start(async () => { await deletePageAction(defaults.id!); });
  }

  return (
    <form onSubmit={submit} className="border border-line bg-white p-5 space-y-3 text-sm">
      <div className="grid sm:grid-cols-2 gap-3">
        <L label="Title"><input name="title" defaultValue={defaults.title} required className="p-inp" /></L>
        <L label="Slug"><input name="slug" defaultValue={defaults.slug} required placeholder="about" className="p-inp" /></L>
        <L label="Status">
          <select name="status" value={status} onChange={(e) => setStatus(e.target.value)} className="p-inp">
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
            <option value="SCHEDULED">Scheduled</option>
          </select>
        </L>
        {status === 'SCHEDULED' && (
          <L label="Publish at"><input name="scheduledAt" type="datetime-local" defaultValue={defaults.scheduledAt} className="p-inp" /></L>
        )}
      </div>
      <L label="SEO title"><input name="seoTitle" defaultValue={defaults.seoTitle} className="p-inp" /></L>
      <L label="SEO description"><textarea name="seoDescription" defaultValue={defaults.seoDescription} rows={2} className="p-inp" /></L>

      {error && <p className="text-xs text-red-700">{error}</p>}
      {msg && <p className="text-xs text-ink-soft">{msg}</p>}

      <div className="flex gap-2">
        <button disabled={pending} className="btn-primary text-xs">{pending ? 'Saving…' : defaults.id ? 'Save page' : 'Create page'}</button>
        {defaults.id && <button type="button" onClick={remove} disabled={pending} className="btn-outline text-xs text-red-700 border-red-300">Delete page</button>}
      </div>
      <style>{`.p-inp{width:100%;border:1px solid var(--line);padding:.5rem .625rem;font-size:.875rem;outline:none}.p-inp:focus{border-color:var(--brass)}`}</style>
    </form>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block mb-1 text-xs text-ink-soft">{label}</span>{children}</label>;
}
