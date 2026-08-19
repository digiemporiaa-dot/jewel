import { requirePermission } from '@/lib/auth/guard';
import { prisma } from '@/lib/prisma';
import PageHeader from '@/components/admin/PageHeader';
import CollectionManager, { type CollectionRow } from './CollectionManager';

export const dynamic = 'force-dynamic';

export default async function CollectionsPage() {
  await requirePermission('collections.manage');

  const rows = await prisma.collection.findMany({
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { products: true } } },
  });

  const collections: CollectionRow[] = rows.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    imageUrl: c.imageUrl,
    order: c.order,
    isActive: c.isActive,
    seoTitle: c.seoTitle,
    seoDescription: c.seoDescription,
    productCount: c._count.products,
  }));

  return (
    <div>
      <PageHeader
        title="Collections"
        description="Curated groupings shown on the storefront. Products are assigned to collections from the product editor."
      />
      <CollectionManager collections={collections} />
    </div>
  );
}
