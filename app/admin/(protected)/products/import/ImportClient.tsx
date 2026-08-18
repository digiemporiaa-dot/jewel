'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toCsv } from '@/lib/csv';
import { cn } from '@/lib/utils/cn';
import { validateImportAction, runImportAction } from './actions';
import type { ImportReport } from '@/lib/admin/import';

const TEMPLATE = `name,slug,sku,categorySlug,pricingMode,metalType,purityName,metalColor,netWeight,wastagePct,gstPercent,fulfilmentType,leadTimeDays,fixedPrice,stockQty,tags,occasion,shortDescription
22K Gold Band,22k-gold-band-demo,RG-DEMO-1,rings,WEIGHT_BASED,GOLD,22K,Yellow,3.5,8,3,READY_TO_SHIP,,,5,"gold,ring",Everyday,A plain 22K band
Silver Studs,silver-studs-demo,ER-DEMO-2,earrings,WEIGHT_BASED,SILVER,925 Silver,White,2.1,6,3,READY_TO_SHIP,,,10,silver,Gifting,Everyday silver studs
Gift Pendant,gift-pendant-demo,PN-DEMO-3,gifting,FIXED,,,Gold-plated,,,3,READY_TO_SHIP,,999,25,imitation,Gifting,Gold-plated gift pendant`;

export default function ImportClient() {
  const router = useRouter();
  const [csv, setCsv] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function loadFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ''));
    reader.readAsText(file);
  }

  function validate() {
    setError(null); setResult(null); setReport(null);
    start(async () => {
      const res = await validateImportAction(csv);
      if (res.ok) setReport(res.report); else setError(res.error);
    });
  }

  function confirmImport() {
    start(async () => {
      const res = await runImportAction(csv);
      if (res.ok) { setResult(`Imported ${res.imported}, skipped ${res.skipped}.`); setReport(null); setCsv(''); router.refresh(); }
      else setError(res.error);
    });
  }

  function downloadErrors() {
    if (!report) return;
    const bad = report.rows.filter((r) => r.status !== 'valid');
    const csvText = toCsv(['rowNumber', 'sku', 'name', 'status', 'issues'], bad.map((r) => ({
      rowNumber: r.rowNumber, sku: r.sku, name: r.name, status: r.status,
      issues: [...r.errors, ...r.warnings].join('; '),
    })));
    const blob = new Blob([csvText], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'import-errors.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div className="border border-line bg-white p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg">1 · Upload / paste CSV</h2>
          <button onClick={() => setCsv(TEMPLATE)} className="btn-outline text-xs py-1.5">Load template</button>
        </div>
        <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} className="text-sm" />
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={8}
          placeholder="Paste CSV here, or upload a file / load the template…"
          className="w-full border border-line px-3 py-2 text-xs font-mono outline-none focus:border-brass"
        />
        <div className="flex gap-2">
          <button onClick={validate} disabled={pending || !csv} className="btn-primary">{pending ? 'Working…' : '2 · Validate (dry run)'}</button>
        </div>
        {error && <p className="text-sm text-red-700">{error}</p>}
        {result && <p className="text-sm">{result}</p>}
      </div>

      {report && (
        <div className="border border-line bg-white p-5 space-y-4">
          <h2 className="font-heading text-lg">3 · Dry-run report</h2>

          {report.headerErrors.length > 0 && (
            <div className="border border-red-300 bg-red-50 p-3 text-sm text-red-700">
              {report.headerErrors.map((e) => <p key={e}>{e}</p>)}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
            <Stat label="Processed" value={report.processed} />
            <Stat label="Valid" value={report.valid} tone="ok" />
            <Stat label="Invalid" value={report.invalid} tone={report.invalid ? 'bad' : undefined} />
            <Stat label="Duplicates" value={report.duplicates} tone={report.duplicates ? 'bad' : undefined} />
            <Stat label="Warnings" value={report.warnings} />
          </div>

          {report.rows.length > 0 && (
            <div className="overflow-x-auto border border-line">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ink-soft border-b border-line">
                  <th className="px-3 py-2">Row</th><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Issues</th>
                </tr></thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.rowNumber} className="border-b border-line/60">
                      <td className="px-3 py-1.5">{r.rowNumber}</td>
                      <td className="px-3 py-1.5">{r.sku || '—'}</td>
                      <td className="px-3 py-1.5">
                        <span className={cn('px-1.5 py-0.5 border rounded-[2px]',
                          r.status === 'valid' ? 'border-velvet text-velvet' : 'border-red-300 text-red-700')}>{r.status}</span>
                      </td>
                      <td className="px-3 py-1.5 text-ink-soft">{[...r.errors, ...r.warnings].join('; ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button onClick={downloadErrors} className="btn-outline text-xs">Download error report</button>
            <button onClick={confirmImport} disabled={pending || report.valid === 0} className="btn-primary text-xs">
              {pending ? 'Importing…' : `4 · Confirm & import ${report.valid} valid`}
            </button>
          </div>
          {report.valid === 0 && <p className="text-xs text-ink-soft">No valid rows to import — fix the issues above and re-validate.</p>}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'bad' }) {
  return (
    <div className="border border-line p-3">
      <p className="text-[0.7rem] tracking-[0.1em] uppercase text-ink-soft">{label}</p>
      <p className={cn('mt-1 font-heading text-xl', tone === 'ok' && 'text-velvet', tone === 'bad' && 'text-red-700')}>{value}</p>
    </div>
  );
}
