import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requirePermission } from '@/lib/auth/guard';
import { getCmsPageForEdit } from '@/lib/cms';
import PageHeader from '@/components/admin/PageHeader';
import PageForm from '../PageForm';
import BlockEditor from '../BlockEditor';
import { storefrontPathForPage } from '@/lib/cms/home';

export const dynamic = 'force-dynamic';

function toLocalInput(d: Date | null): string {
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default async function EditCmsPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('cms.manage');
  const { id } = await params;
  const page = await getCmsPageForEdit(id);
  if (!page) notFound();

  return (
    <div className="space-y-6">
      <PageHeader title={page.title} description={storefrontPathForPage(page.slug)} action={{ label: 'Back to CMS', href: '/admin/cms' }} />
      <Link href={storefrontPathForPage(page.slug)} className="text-sm underline underline-offset-4 hover:text-brass">View on storefront</Link>

      <PageForm
        defaults={{
          id: page.id, title: page.title, slug: page.slug, status: page.status,
          scheduledAt: toLocalInput(page.scheduledAt),
          seoTitle: page.seoTitle ?? '', seoDescription: page.seoDescription ?? '',
          ogImageUrl: page.ogImageUrl ?? '', canonicalUrl: page.canonicalUrl ?? '', noIndex: page.noIndex,
        }}
      />

      <div>
        <h2 className="font-heading text-xl mb-3">Content blocks</h2>
        <BlockEditor
          pageId={page.id}
          pageSlug={page.slug}
          blocks={page.blocks.map((b) => ({
            id: b.id, type: b.type, order: b.order, isActive: b.isActive,
            data: (b.data ?? {}) as Record<string, unknown>,
          }))}
        />
      </div>
    </div>
  );
}
