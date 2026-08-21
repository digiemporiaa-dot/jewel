'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@/lib/utils/cn';
import {
  createNavItemAction, updateNavItemAction, deleteNavItemAction,
  moveNavItemAction, toggleNavItemAction, resetMenuAction,
} from './actions';

type Item = {
  id: string;
  label: string;
  href: string;
  order: number;
  isActive: boolean;
  parentId: string | null;
};

type LinkOption = { group: string; label: string; href: string };

type Issue = { href: string; kind: 'missing' | 'unpublished'; slug: string; status?: string };

export default function NavigationManager({
  menuId, menuKey, menuLabel, items, linkOptions, issues,
}: {
  menuId: string;
  menuKey: string;
  menuLabel: string;
  items: Item[];
  linkOptions: LinkOption[];
  issues: Issue[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const issueByHref = useMemo(() => new Map(issues.map((i) => [i.href, i])), [issues]);
  const topLevel = items.filter((i) => !i.parentId);
  const childrenOf = (id: string) => items.filter((i) => i.parentId === id);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setMsg(null);
    start(async () => {
      const res = await fn();
      setMsg(res.ok ? okMsg : res.error ?? 'Failed');
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {issues.length > 0 && <BrokenLinkNotice issues={issues} />}

      <div className="border border-line bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="font-heading text-lg">{menuLabel}</h2>
          <div className="flex items-center gap-3">
            {msg && <span className="text-xs text-ink-soft">{msg}</span>}
            <button
              onClick={() => {
                if (!confirm(`Replace every link in "${menuLabel}" with the built-in defaults?`)) return;
                run(() => resetMenuAction(menuId), 'Menu reset to defaults');
              }}
              disabled={pending}
              className="btn-outline text-xs"
            >
              Reset to defaults
            </button>
          </div>
        </div>

        {topLevel.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-ink-soft">
            <p>This menu is empty.</p>
            <p className="mt-1">
              The storefront is showing its built-in {menuKey} navigation instead, so nothing looks
              broken to shoppers — but nothing here is under your control until you add a link.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {topLevel.map((item, index) => (
              <li key={item.id}>
                <ItemRow
                  item={item}
                  issue={issueByHref.get(item.href)}
                  pending={pending}
                  isFirst={index === 0}
                  isLast={index === topLevel.length - 1}
                  linkOptions={linkOptions}
                  onSave={(fd) => run(() => updateNavItemAction(item.id, fd), 'Saved')}
                  onMove={(dir) => run(() => moveNavItemAction(item.id, dir), 'Reordered')}
                  onToggle={() => run(() => toggleNavItemAction(item.id), 'Updated')}
                  onDelete={(childCount) => {
                    const warning = childCount > 0
                      ? `Delete "${item.label}" and its ${childCount} dropdown link${childCount === 1 ? '' : 's'}?`
                      : `Delete "${item.label}"?`;
                    if (!confirm(warning)) return;
                    run(() => deleteNavItemAction(item.id), 'Deleted');
                  }}
                  childCount={childrenOf(item.id).length}
                />

                {childrenOf(item.id).map((child, ci, arr) => (
                  <div key={child.id} className="border-t border-line/60 bg-paper-2/40 pl-6">
                    <ItemRow
                      item={child}
                      issue={issueByHref.get(child.href)}
                      pending={pending}
                      isFirst={ci === 0}
                      isLast={ci === arr.length - 1}
                      linkOptions={linkOptions}
                      nested
                      onSave={(fd) => run(() => updateNavItemAction(child.id, fd), 'Saved')}
                      onMove={(dir) => run(() => moveNavItemAction(child.id, dir), 'Reordered')}
                      onToggle={() => run(() => toggleNavItemAction(child.id), 'Updated')}
                      onDelete={() => {
                        if (!confirm(`Delete "${child.label}"?`)) return;
                        run(() => deleteNavItemAction(child.id), 'Deleted');
                      }}
                      childCount={0}
                    />
                  </div>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>

      <AddItemForm
        menuId={menuId}
        parents={topLevel}
        linkOptions={linkOptions}
        pending={pending}
        onSubmit={(fd) => run(() => createNavItemAction(fd), 'Link added')}
      />

      <style>{`.n-inp{width:100%;border:1px solid var(--line);padding:.45rem .6rem;font-size:.85rem;outline:none;background:#fff}.n-inp:focus{border-color:var(--brass)}`}</style>
    </div>
  );
}

function BrokenLinkNotice({ issues }: { issues: Issue[] }) {
  const missing = issues.filter((i) => i.kind === 'missing');
  const unpublished = issues.filter((i) => i.kind === 'unpublished');

  return (
    <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
      <p className="font-heading text-base text-amber-900">
        {issues.length} link{issues.length === 1 ? '' : 's'} in this menu will not work
      </p>
      {missing.length > 0 && (
        <p className="mt-1.5 text-amber-900/85">
          <strong>{missing.length} point at a page that does not exist</strong> — visitors get a 404:{' '}
          {missing.map((i) => i.slug).join(', ')}.
        </p>
      )}
      {unpublished.length > 0 && (
        <p className="mt-1.5 text-amber-900/85">
          <strong>{unpublished.length} point at an unpublished page</strong> — only staff can see them
          until the page is published: {unpublished.map((i) => i.slug).join(', ')}.
        </p>
      )}
      <Link
        href="/admin/cms"
        className="mt-2 inline-block text-xs underline decoration-amber-400 underline-offset-4 hover:text-amber-950"
      >
        Fix in CMS Pages
      </Link>
    </div>
  );
}

function IssueBadge({ issue }: { issue: Issue }) {
  const missing = issue.kind === 'missing';
  return (
    <span
      title={missing ? `No page exists at /pages/${issue.slug}` : `/pages/${issue.slug} is ${issue.status}`}
      className={cn(
        'shrink-0 px-1.5 py-0.5 text-[0.65rem] tracking-[0.06em] uppercase border',
        missing ? 'border-red-300 bg-red-50 text-red-800' : 'border-amber-300 bg-amber-50 text-amber-900'
      )}
    >
      {missing ? 'Missing page' : 'Unpublished'}
    </span>
  );
}

function ItemRow({
  item, issue, pending, isFirst, isLast, linkOptions, childCount, nested = false,
  onSave, onMove, onToggle, onDelete,
}: {
  item: Item;
  issue?: Issue;
  pending: boolean;
  isFirst: boolean;
  isLast: boolean;
  linkOptions: LinkOption[];
  childCount: number;
  nested?: boolean;
  onSave: (fd: FormData) => void;
  onMove: (dir: 'up' | 'down') => void;
  onToggle: () => void;
  onDelete: (childCount: number) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <form
        action={(fd) => { onSave(fd); setEditing(false); }}
        className="px-4 py-3 grid sm:grid-cols-[1fr_1.4fr_auto] gap-2 items-end"
      >
        <label className="block">
          <span className="block mb-1 text-xs text-ink-soft">Label</span>
          <input name="label" defaultValue={item.label} required maxLength={60} className="n-inp" />
        </label>
        <LinkField defaultValue={item.href} linkOptions={linkOptions} />
        <div className="flex gap-2">
          <button type="submit" disabled={pending} className="btn-primary text-xs">Save</button>
          <button type="button" onClick={() => setEditing(false)} className="btn-outline text-xs">Cancel</button>
        </div>
      </form>
    );
  }

  return (
    <div className={cn('px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1.5', !item.isActive && 'opacity-55')}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{item.label}</span>
          {issue && <IssueBadge issue={issue} />}
          {!item.isActive && (
            <span className="shrink-0 text-[0.65rem] tracking-[0.06em] uppercase text-ink-soft border border-line px-1.5 py-0.5">
              Hidden
            </span>
          )}
          {childCount > 0 && (
            <span className="shrink-0 text-[0.65rem] text-ink-soft">
              {childCount} dropdown link{childCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <p className="text-xs text-ink-soft truncate">{item.href}</p>
      </div>

      <div className="flex items-center gap-1">
        <button onClick={() => onMove('up')} disabled={pending || isFirst} aria-label={`Move ${item.label} up`} className="px-2 py-1 border border-line text-xs disabled:opacity-30">↑</button>
        <button onClick={() => onMove('down')} disabled={pending || isLast} aria-label={`Move ${item.label} down`} className="px-2 py-1 border border-line text-xs disabled:opacity-30">↓</button>
        <button onClick={() => setEditing(true)} disabled={pending} className="btn-outline text-xs py-1 px-2">Edit</button>
        <button onClick={onToggle} disabled={pending} className="btn-outline text-xs py-1 px-2">{item.isActive ? 'Hide' : 'Show'}</button>
        <button onClick={() => onDelete(childCount)} disabled={pending} className="btn-outline text-xs py-1 px-2 text-red-700 border-red-300">Delete</button>
      </div>
      {nested && <span className="sr-only">Dropdown link</span>}
    </div>
  );
}

/**
 * Link picker: choose a live destination, or switch to a free-text field for
 * anything the store does not know about. The two share one `href` input so the
 * server sees a single validated value either way.
 */
function LinkField({ defaultValue, linkOptions }: { defaultValue?: string; linkOptions: LinkOption[] }) {
  const known = linkOptions.some((o) => o.href === defaultValue);
  const [custom, setCustom] = useState(Boolean(defaultValue) && !known);
  const [value, setValue] = useState(defaultValue ?? '');

  const groups = useMemo(() => {
    const map = new Map<string, LinkOption[]>();
    for (const o of linkOptions) {
      const arr = map.get(o.group) ?? [];
      arr.push(o);
      map.set(o.group, arr);
    }
    return [...map.entries()];
  }, [linkOptions]);

  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between gap-2 text-xs text-ink-soft">
        <span>Links to</span>
        <button
          type="button"
          onClick={() => setCustom((c) => !c)}
          className="underline decoration-line-strong underline-offset-2 hover:text-brass"
        >
          {custom ? 'Pick from store' : 'Enter a URL'}
        </button>
      </span>
      {custom ? (
        <input
          name="href"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
          maxLength={300}
          placeholder="/pages/contact or https://example.com"
          className="n-inp"
        />
      ) : (
        <select name="href" value={value} onChange={(e) => setValue(e.target.value)} required className="n-inp">
          <option value="" disabled>Choose a destination…</option>
          {groups.map(([group, options]) => (
            <optgroup key={group} label={group}>
              {options.map((o) => <option key={o.href} value={o.href}>{o.label}</option>)}
            </optgroup>
          ))}
        </select>
      )}
    </label>
  );
}

function AddItemForm({
  menuId, parents, linkOptions, pending, onSubmit,
}: {
  menuId: string;
  parents: Item[];
  linkOptions: LinkOption[];
  pending: boolean;
  onSubmit: (fd: FormData) => void;
}) {
  const [key, setKey] = useState(0);

  return (
    <form
      key={key}
      action={(fd) => { onSubmit(fd); setKey((k) => k + 1); }}
      className="border border-line bg-white p-4"
    >
      <h3 className="font-heading text-base mb-3">Add a link</h3>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
        <input type="hidden" name="menuId" value={menuId} />
        <label className="block">
          <span className="block mb-1 text-xs text-ink-soft">Label</span>
          <input name="label" required maxLength={60} placeholder="Necklaces" className="n-inp" />
        </label>
        <LinkField linkOptions={linkOptions} />
        <label className="block">
          <span className="block mb-1 text-xs text-ink-soft">Nest under</span>
          <select name="parentId" defaultValue="" className="n-inp">
            <option value="">Top level</option>
            {parents.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <button type="submit" disabled={pending} className="btn-primary text-xs">Add link</button>
      </div>
      <p className="mt-2 text-xs text-ink-soft">
        Menus support one level of nesting — a top-level item and its dropdown.
      </p>
    </form>
  );
}
