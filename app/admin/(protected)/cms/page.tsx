import Link from 'next/link';
import { requirePermission } from '@/lib/auth/guard';
import { listCmsPages } from '@/lib/cms';
import { formatDate } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import PageHeader from '@/components/admin/PageHeader';
import HomepageSetup from './HomepageSetup';
import { isHomeSlug, storefrontPathForPage, pageKindLabel } from '@/lib/cms/home';

export const dynamic = 'force-dynamic';

export default async function CmsListPage() {
  await requirePermission('cms.manage');
  const pages = await listCmsPages();
  const hasHomepage = pages.some((p) => isHomeSlug(p.slug));
  // The homepage first, whatever it was last edited: it is the page staff come
  // looking for, and burying it under alphabetical policy pages hides it.
  const ordered = [...pages].sort((a, b) => Number(isHomeSlug(b.slug)) - Number(isHomeSlug(a.slug)));

  return (
    <div>
      <PageHeader title="CMS Pages" description="Block-based pages — no free-form HTML." action={{ label: 'New page', href: '/admin/cms/new' }} />

      {!hasHomepage && <HomepageSetup />}

      {pages.length === 0 ? (
        <div className="border border-line bg-white p-10 text-center">
          <p className="font-heading text-lg">No pages yet</p>
          <Link href="/admin/cms/new" className="btn-primary mt-4 inline-flex">Create your first page</Link>
        </div>
      ) : (
        <div className="border border-line bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-soft border-b border-line">
                <th className="px-4 py-2 font-medium">Page</th>
                <th className="px-4 py-2 font-medium">Slug</th>
                <th className="px-4 py-2 font-medium">Blocks</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((p) => (
                <tr key={p.id} className="border-b border-line/60 hover:bg-paper-2/40">
                  <td className="px-4 py-2">
                    <Link href={`/admin/cms/${p.id}`} className="font-medium hover:text-brass">{p.title}</Link>
                    {pageKindLabel(p.slug) && (
                      <span className="ml-2 text-[10px] tracking-[0.1em] uppercase border border-brass text-brass px-1.5 py-0.5 rounded-[2px]">
                        {pageKindLabel(p.slug)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-ink-soft">{storefrontPathForPage(p.slug)}</td>
                  <td className="px-4 py-2">{p._count.blocks}</td>
                  <td className="px-4 py-2">
                    <span className={cn('text-xs px-2 py-0.5 border rounded-[2px]', p.status === 'PUBLISHED' ? 'border-velvet text-velvet' : 'border-line text-ink-soft')}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-ink-soft">{formatDate(p.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
