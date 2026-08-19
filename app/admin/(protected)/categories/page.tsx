import { requirePermission } from '@/lib/auth/guard';
import { prisma } from '@/lib/prisma';
import PageHeader from '@/components/admin/PageHeader';
import CategoryManager, { type CategoryRow } from './CategoryManager';

export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  await requirePermission('categories.manage');

  const rows = await prisma.category.findMany({
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
    include: {
      parent: { select: { name: true } },
      _count: { select: { products: true, children: true } },
    },
  });

  const categories: CategoryRow[] = rows.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    imageUrl: c.imageUrl,
    order: c.order,
    isActive: c.isActive,
    parentId: c.parentId,
    parentName: c.parent?.name ?? null,
    seoTitle: c.seoTitle,
    seoDescription: c.seoDescription,
    productCount: c._count.products,
    childCount: c._count.children,
  }));

  return (
    <div>
      <PageHeader
        title="Categories"
        description="Catalogue taxonomy. Order controls the storefront menu; hidden categories stay reachable by direct URL only."
      />
      <CategoryManager categories={categories} />
    </div>
  );
}
