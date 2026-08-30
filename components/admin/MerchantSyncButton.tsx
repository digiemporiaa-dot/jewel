'use client';

import { useState, useTransition } from 'react';

type Outcome =
  | { state: 'skipped'; reason: string }
  | { state: 'done'; succeeded: number; failed: number; skipped: number; firstErrors: string[] }
  | { state: 'timeout'; afterMs: number };

/**
 * Push the catalogue to Google Shopping on demand.
 *
 * The nightly reprice already does this. This is for the minutes after a bulk
 * import or a batch of edits, when waiting until tomorrow means a day of
 * Shopping listings that do not match the shop.
 *
 * It reports what Google actually said, item by item where it fits. A sync
 * button that only ever says "done" is worse than no button: it tells the
 * operator the listings are right when Google may have rejected every one of
 * them.
 */
export default function MerchantSyncButton({ configured }: { configured: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  function sync() {
    setError(null);
    setResult(null);
    start(async () => {
      try {
        const res = await fetch('/api/admin/merchant-sync', { method: 'POST' });
        const body: unknown = await res.json().catch(() => null);
        const payload = (body ?? {}) as { ok?: boolean; error?: string; result?: Outcome };
        if (!res.ok || !payload.ok) {
          setError(payload.error ?? 'Sync failed.');
          return;
        }
        setResult(payload.result ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Sync failed.');
      }
    });
  }

  return (
    <div className="text-sm">
      <button onClick={sync} disabled={pending || !configured} className="btn-outline text-xs disabled:opacity-50">
        {pending ? 'Syncing…' : 'Sync to Google Shopping'}
      </button>

      {!configured && (
        <p className="mt-2 text-xs text-ink-soft">
          Not connected yet. Set <code>GOOGLE_MERCHANT_ID</code> and <code>GOOGLE_SERVICE_ACCOUNT_JSON</code>,
          then redeploy. In Coolify the key must be pasted as a <strong>Literal</strong> — it contains
          characters a shell would otherwise treat as variables.
        </p>
      )}

      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}

      {result?.state === 'skipped' && <p className="mt-2 text-xs text-ink-soft">{result.reason}</p>}

      {result?.state === 'timeout' && (
        <p className="mt-2 text-xs text-ink-soft">
          Still running after {Math.round(result.afterMs / 1000)}s. It has not been cancelled — Google is
          simply slow. Check Merchant Center in a few minutes.
        </p>
      )}

      {result?.state === 'done' && (
        <div className="mt-2 text-xs text-ink-soft">
          <p>
            <span className="text-ink">{result.succeeded} sent</span>
            {result.failed > 0 && <span className="text-red-700">, {result.failed} rejected</span>}
            {result.skipped > 0 && <span>, {result.skipped} not eligible</span>}.
          </p>
          {result.firstErrors.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {result.firstErrors.map((e) => (
                <li key={e} className="break-all">• {e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
