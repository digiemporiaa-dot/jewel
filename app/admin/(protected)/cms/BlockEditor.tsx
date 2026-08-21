'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import { BLOCK_LABELS } from '@/lib/cms/blocks';
import {
  resolveBlockStyle, parseBlockStyle, styleControlsFor, styleOptions,
  STYLE_CONTROL_LABELS, STYLE_OPTION_LABELS,
  type StyleControl,
} from '@/lib/cms/style';
import { addBlockAction, saveBlockAction, deleteBlockAction, moveBlockAction, toggleBlockAction } from './actions';
import type { CmsBlockType } from '@prisma/client';

type Block = { id: string; type: string; order: number; isActive: boolean; data: Record<string, unknown> };

const BLOCK_TYPES = Object.keys(BLOCK_LABELS) as (keyof typeof BLOCK_LABELS)[];

/**
 * Field descriptors per block type — mirrors lib/cms/blocks.ts schemas.
 *
 * RICH_TEXT.align, IMAGE_TEXT.imagePosition and BANNER.tone are deliberately
 * absent: the Design panel below owns those now. They remain in the stored
 * content (kept in step by `syncLegacyFields` on save) so older data stays valid,
 * but showing two controls for one visual outcome would only invite them to
 * disagree.
 */
const FIELDS: Record<string, { key: string; label: string; kind: 'text' | 'textarea' | 'number' | 'select'; options?: string[] }[]> = {
  HERO: [
    { key: 'eyebrow', label: 'Eyebrow', kind: 'text' },
    { key: 'heading', label: 'Heading', kind: 'text' },
    { key: 'subheading', label: 'Subheading', kind: 'textarea' },
    { key: 'imageUrl', label: 'Image URL', kind: 'text' },
    { key: 'ctaLabel', label: 'Button label', kind: 'text' },
    { key: 'ctaHref', label: 'Button link', kind: 'text' },
  ],
  RICH_TEXT: [
    { key: 'heading', label: 'Heading', kind: 'text' },
    { key: 'body', label: 'Body (one paragraph per line)', kind: 'textarea' },
  ],
  IMAGE_TEXT: [
    { key: 'heading', label: 'Heading', kind: 'text' },
    { key: 'body', label: 'Body', kind: 'textarea' },
    { key: 'imageUrl', label: 'Image URL', kind: 'text' },
    { key: 'ctaLabel', label: 'Button label', kind: 'text' },
    { key: 'ctaHref', label: 'Button link', kind: 'text' },
  ],
  PRODUCT_GRID: [
    { key: 'heading', label: 'Heading', kind: 'text' },
    { key: 'source', label: 'Source', kind: 'select', options: ['featured', 'new', 'bestsellers'] },
    { key: 'limit', label: 'How many', kind: 'number' },
  ],
  COLLECTION_GRID: [
    { key: 'heading', label: 'Heading', kind: 'text' },
    { key: 'limit', label: 'How many', kind: 'number' },
  ],
  BANNER: [
    { key: 'text', label: 'Text', kind: 'text' },
    { key: 'ctaLabel', label: 'Button label', kind: 'text' },
    { key: 'ctaHref', label: 'Button link', kind: 'text' },
  ],
  CTA: [
    { key: 'heading', label: 'Heading', kind: 'text' },
    { key: 'subheading', label: 'Subheading', kind: 'textarea' },
    { key: 'ctaLabel', label: 'Button label', kind: 'text' },
    { key: 'ctaHref', label: 'Button link', kind: 'text' },
  ],
};

// Blocks whose content is a repeatable list of {a,b} pairs.
const LIST_BLOCKS: Record<string, { heading: boolean; itemKeys: [string, string]; itemLabels: [string, string] }> = {
  FAQ: { heading: true, itemKeys: ['question', 'answer'], itemLabels: ['Question', 'Answer'] },
  TRUST_ROW: { heading: false, itemKeys: ['title', 'subtitle'], itemLabels: ['Title', 'Subtitle'] },
  TESTIMONIALS: { heading: true, itemKeys: ['quote', 'author'], itemLabels: ['Quote', 'Author'] },
};

export default function BlockEditor({ pageId, pageSlug, blocks }: { pageId: string; pageSlug: string; blocks: Block[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [newType, setNewType] = useState<string>('HERO');
  const [msg, setMsg] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg = 'Saved') {
    setMsg(null);
    start(async () => {
      const res = await fn();
      setMsg(res.ok ? okMsg : res.error ?? 'Failed');
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="border border-line bg-white p-4 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="block mb-1 text-xs text-ink-soft">Add a block</span>
          <select value={newType} onChange={(e) => setNewType(e.target.value)} className="border border-line px-2 py-1.5 text-sm outline-none focus:border-brass">
            {BLOCK_TYPES.map((t) => <option key={t} value={t}>{BLOCK_LABELS[t]}</option>)}
          </select>
        </label>
        <button disabled={pending} onClick={() => run(() => addBlockAction(pageId, newType), 'Block added')} className="btn-outline text-xs">Add</button>
        {msg && <span className="text-xs text-ink-soft ml-auto">{msg}</span>}
      </div>

      {blocks.length === 0 ? (
        <div className="border border-line bg-white p-8 text-center text-sm text-ink-soft">No blocks yet — add one above.</div>
      ) : (
        blocks.map((b) => (
          <BlockCard
            key={b.id} block={b} pending={pending} pageSlug={pageSlug}
            onSave={(data) => run(() => saveBlockAction(b.id, data))}
            onDelete={() => run(() => deleteBlockAction(b.id), 'Block removed')}
            onMove={(dir) => run(() => moveBlockAction(b.id, dir), 'Reordered')}
            onToggle={() => run(() => toggleBlockAction(b.id), 'Updated')}
          />
        ))
      )}
    </div>
  );
}

function BlockCard({
  block, pending, pageSlug, onSave, onDelete, onMove, onToggle,
}: {
  block: Block; pending: boolean; pageSlug: string;
  onSave: (data: Record<string, unknown>) => void;
  onDelete: () => void;
  onMove: (dir: 'up' | 'down') => void;
  onToggle: () => void;
}) {
  const [data, setData] = useState<Record<string, unknown>>(block.data ?? {});
  const listCfg = LIST_BLOCKS[block.type];
  const fields = FIELDS[block.type] ?? [];

  const blockType = block.type as CmsBlockType;
  // Resolving rather than reading `data.style` directly means a block saved
  // before this feature existed opens showing the values it actually renders
  // with, not a set of blanks.
  const style = resolveBlockStyle(blockType, data);
  const controls = styleControlsFor(blockType);

  function set(key: string, value: unknown) {
    setData((d) => ({ ...d, [key]: value }));
  }

  function setStyle(control: StyleControl, raw: string) {
    // Round-trip through the same validator the server uses, so the editor can
    // never put a value into `data.style` that the renderer would then discard.
    const candidate = { ...style, [control]: control === 'columns' ? Number(raw) : raw };
    setData((d) => ({ ...d, style: { ...style, ...parseBlockStyle(blockType, candidate) } }));
  }

  const items = (Array.isArray(data.items) ? data.items : []) as Record<string, string>[];
  function setItem(i: number, key: string, value: string) {
    const next = items.map((it, idx) => (idx === i ? { ...it, [key]: value } : it));
    set('items', next);
  }

  return (
    <div className={cn('border bg-white p-4 space-y-3 text-sm', block.isActive ? 'border-line' : 'border-line-strong opacity-60')}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-heading text-base">{BLOCK_LABELS[block.type as keyof typeof BLOCK_LABELS] ?? block.type} <span className="text-xs text-ink-soft">#{block.order}</span></h3>
        <div className="flex gap-1">
          <button onClick={() => onMove('up')} disabled={pending} className="px-2 border border-line text-xs">↑</button>
          <button onClick={() => onMove('down')} disabled={pending} className="px-2 border border-line text-xs">↓</button>
          <button onClick={onToggle} disabled={pending} className="btn-outline text-xs py-1 px-2">{block.isActive ? 'Hide' : 'Show'}</button>
          <button onClick={onDelete} disabled={pending} className="btn-outline text-xs py-1 px-2 text-red-700 border-red-300">Delete</button>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {fields.map((f) => (
          <label key={f.key} className={cn('block', f.kind === 'textarea' && 'sm:col-span-2')}>
            <span className="block mb-1 text-xs text-ink-soft">{f.label}</span>
            {f.kind === 'textarea' ? (
              <textarea value={String(data[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} rows={3} className="b-inp" />
            ) : f.kind === 'select' ? (
              <select value={String(data[f.key] ?? f.options?.[0] ?? '')} onChange={(e) => set(f.key, e.target.value)} className="b-inp">
                {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                type={f.kind === 'number' ? 'number' : 'text'}
                value={String(data[f.key] ?? '')}
                onChange={(e) => set(f.key, f.kind === 'number' ? Number(e.target.value) : e.target.value)}
                className="b-inp"
              />
            )}
          </label>
        ))}
      </div>

      {listCfg && (
        <div className="space-y-2">
          {listCfg.heading && (
            <label className="block">
              <span className="block mb-1 text-xs text-ink-soft">Heading</span>
              <input value={String(data.heading ?? '')} onChange={(e) => set('heading', e.target.value)} className="b-inp" />
            </label>
          )}
          {items.map((it, i) => (
            <div key={i} className="grid sm:grid-cols-2 gap-2 border border-line p-2">
              <label className="block">
                <span className="block mb-1 text-xs text-ink-soft">{listCfg.itemLabels[0]}</span>
                <input value={it[listCfg.itemKeys[0]] ?? ''} onChange={(e) => setItem(i, listCfg.itemKeys[0], e.target.value)} className="b-inp" />
              </label>
              <label className="block">
                <span className="block mb-1 text-xs text-ink-soft">{listCfg.itemLabels[1]}</span>
                <input value={it[listCfg.itemKeys[1]] ?? ''} onChange={(e) => setItem(i, listCfg.itemKeys[1], e.target.value)} className="b-inp" />
              </label>
              <button type="button" onClick={() => set('items', items.filter((_, idx) => idx !== i))} className="text-xs text-red-700 justify-self-start">Remove</button>
            </div>
          ))}
          <button type="button" onClick={() => set('items', [...items, { [listCfg.itemKeys[0]]: '', [listCfg.itemKeys[1]]: '' }])} className="btn-outline text-xs">Add item</button>
        </div>
      )}

      <fieldset className="border border-line p-3">
        <legend className="px-1 text-xs tracking-[0.1em] uppercase text-ink-soft">Design</legend>
        <div className="grid sm:grid-cols-3 gap-3">
          {controls.map((control) => (
            <label key={control} className="block">
              <span className="block mb-1 text-xs text-ink-soft">{STYLE_CONTROL_LABELS[control]}</span>
              <select
                value={String(style[control])}
                onChange={(e) => setStyle(control, e.target.value)}
                className="b-inp"
              >
                {styleOptions(control).map((o) => (
                  <option key={String(o)} value={String(o)}>
                    {STYLE_OPTION_LABELS[String(o)] ?? String(o)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-soft">
          Fixed options only, so the page stays on-brand. A velvet background switches text to light automatically.
        </p>
      </fieldset>

      <div className="flex items-center gap-3">
        <button onClick={() => onSave(data)} disabled={pending} className="btn-primary text-xs">Save block</button>
        <a
          href={`/pages/${pageSlug}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs underline decoration-line-strong underline-offset-4 hover:text-brass"
        >
          View on storefront
        </a>
      </div>
      <style>{`.b-inp{width:100%;border:1px solid var(--line);padding:.45rem .6rem;font-size:.85rem;outline:none}.b-inp:focus{border-color:var(--brass)}`}</style>
    </div>
  );
}
