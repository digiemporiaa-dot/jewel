import { assertPermission } from '@/lib/auth/guard';
import { listRedirects } from '@/lib/redirects';
import RedirectsClient from './RedirectsClient';
import { saveRedirectAction, toggleRedirectAction, deleteRedirectAction, importRedirectsAction } from './actions';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Redirects' };

export default async function RedirectsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await assertPermission('settings.manage');
  const { page } = await searchParams;
  const list = await listRedirects({ page: Number(page) || 1 });

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-heading text-2xl">Redirects</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Sends visitors from an old address to its replacement, so links that already exist keep
          working. One is added automatically whenever a product, category, collection, page or
          journal post changes address.
        </p>
      </header>

      <RedirectsClient
        total={list.total}
        rows={list.items.map((r) => ({
          id: r.id,
          fromPath: r.fromPath,
          toPath: r.toPath,
          statusCode: r.statusCode,
          isActive: r.isActive,
          isAutomatic: r.isAutomatic,
          note: r.note,
          hitCount: r.hitCount,
          lastHitAt: r.lastHitAt?.toISOString() ?? null,
        }))}
        save={saveRedirectAction}
        toggle={toggleRedirectAction}
        remove={deleteRedirectAction}
        importCsv={importRedirectsAction}
      />
    </div>
  );
}
