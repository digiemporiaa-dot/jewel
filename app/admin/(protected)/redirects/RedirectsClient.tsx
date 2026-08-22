'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Result, ImportResult } from './actions';

export type RedirectRow = {
  id: string;
  fromPath: string;
  toPath: string;
  statusCode: number;
  isActive: boolean;
  isAutomatic: boolean;
  note: string | null;
  hitCount: number;
  lastHitAt: string | null;
};

export default function RedirectsClient({
  rows, total, save, toggle, remove, importCsv,
}: {
  rows: RedirectRow[];
  total: number;
  save: (fd: FormData) => Promise<Result>;
  toggle: (id: string, isActive: boolean) => Promise<Result>;
  remove: (id: string) => Promise<Result>;
  importCsv: (fd: FormData) => Promise<ImportResult>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importReport, setImportReport] = useState<ImportResult | null>(null);

  function onSave(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await save(fd);
      if (!res.ok) return setError(res.error ?? 'Could not save');
      router.refresh();
    });
  }

  function onImport(fd: FormData) {
    setError(null);
    setImportReport(null);
    start(async () => {
      const res = await importCsv(fd);
      setImportReport(res);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <section className="border border-line bg-white p-4">
        <h2 className="font-heading text-lg">Add a redirect</h2>
        <form action={onSave} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
          <L label="Old path">
            <input name="fromPath" required placeholder="/old-ring" className="r-inp" />
          </L>
          <L label="Send to">
            <input name="toPath" required placeholder="/p/new-ring" className="r-inp" />
          </L>
          <L label="Type">
            <select name="statusCode" defaultValue="301" className="r-inp">
              <option value="301">Permanent</option>
              <option value="302">Temporary</option>
            </select>
          </L>
          <div className="flex items-end">
            <button type="submit" disabled={pending} className="btn-primary h-[38px] text-xs">Add</button>
          </div>
          <div className="sm:col-span-4">
            <L label="Note (optional)">
              <input name="note" placeholder="Old print campaign" maxLength={200} className="r-inp" />
            </L>
          </div>
        </form>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        <p className="mt-2 text-xs text-ink-soft">
          Use <strong>Permanent</strong> when a page has moved for good — it passes the old page&rsquo;s
          search ranking to the new one. Use <strong>Temporary</strong> for something coming back, like
          a sale page.
        </p>
      </section>

      <section className="border border-line bg-white p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-heading text-lg">Import a list</h2>
          <button
            type="button"
            onClick={() => setShowImport((v) => !v)}
            className="text-xs underline underline-offset-4 text-ink-soft hover:text-ink"
          >
            {showImport ? 'Hide' : 'Show'}
          </button>
        </div>
        {showImport && (
          <form action={onImport} className="mt-3 space-y-2">
            <textarea
              name="csv"
              rows={8}
              placeholder={'/old-ring,/p/new-ring\n/old-set,/p/new-set,302'}
              className="r-inp font-mono text-xs"
            />
            <p className="text-xs text-ink-soft">
              One per line: old path, new path, and optionally 301 or 302. Commas or tabs both work,
              so you can paste straight out of a spreadsheet. A header row is ignored.
            </p>
            <button type="submit" disabled={pending} className="btn-outline text-xs">
              {pending ? 'Importing…' : 'Import'}
            </button>
          </form>
        )}
        {importReport && <ImportReport report={importReport} />}
      </section>

      <section className="border border-line bg-white">
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-heading text-lg">Redirects <span className="text-sm text-ink-soft">({total})</span></h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            Most-used first. A rule with hits is carrying real traffic — switch it off rather than
            deleting it if you are unsure.
          </p>
        </div>

        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-soft">
            No redirects yet. One is added automatically whenever you change a product, category or
            page address.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs">
                    <span className={row.isActive ? '' : 'line-through text-ink-soft'}>{row.fromPath}</span>
                    <span className="mx-1.5 text-ink-soft">→</span>
                    <span className="text-ink-soft">{row.toPath}</span>
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-soft">
                    <span>{row.statusCode === 302 ? 'Temporary' : 'Permanent'}</span>
                    {row.isAutomatic && <span className="border border-line px-1">Automatic</span>}
                    {!row.isActive && <span className="border border-amber-300 bg-amber-50 px-1 text-amber-900">Off</span>}
                    <span>{row.hitCount === 0 ? 'never used' : `used ${row.hitCount}×`}</span>
                    {row.note && <span className="italic">{row.note}</span>}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => start(async () => { await toggle(row.id, !row.isActive); router.refresh(); })}
                    className="border border-line px-2 py-1 text-xs"
                  >
                    {row.isActive ? 'Turn off' : 'Turn on'}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      // Two steps, because a rule with hits is carrying traffic
                      // somebody is relying on.
                      const warning = row.hitCount > 0
                        ? `This redirect has been used ${row.hitCount} times. Delete it anyway?`
                        : 'Delete this redirect?';
                      if (!confirm(warning)) return;
                      start(async () => { await remove(row.id); router.refresh(); });
                    }}
                    className="border border-line px-2 py-1 text-xs text-ink-soft"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <style>{`.r-inp{width:100%;border:1px solid var(--line);padding:.45rem .6rem;font-size:.875rem;outline:none;background:#fff}.r-inp:focus{border-color:var(--brass)}`}</style>
    </div>
  );
}

function ImportReport({ report }: { report: ImportResult }) {
  if (!report.ok) return <p className="mt-3 text-sm text-red-700">{report.error}</p>;

  const rejected = [
    ...report.parseErrors,
    ...report.summary.skipped,
  ];

  return (
    <div className="mt-3 space-y-2 border-t border-line pt-3 text-sm">
      <p>
        <strong>{report.summary.created}</strong> added, <strong>{report.summary.updated}</strong> updated
        {rejected.length > 0 && <>, <strong className="text-red-700">{rejected.length}</strong> rejected</>}.
      </p>
      {rejected.length > 0 && (
        <ul className="space-y-1">
          {rejected.slice(0, 25).map((r, i) => (
            <li key={i} className="text-xs text-red-700">
              Line {r.line}: <span className="font-mono">{r.raw}</span> — {r.error}
            </li>
          ))}
          {rejected.length > 25 && (
            <li className="text-xs text-ink-soft">and {rejected.length - 25} more</li>
          )}
        </ul>
      )}
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-ink-soft">{label}</span>
      {children}
    </label>
  );
}
