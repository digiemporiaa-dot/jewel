import Link from 'next/link';
import { requirePermission } from '@/lib/auth/guard';
import { listProducts } from '@/lib/admin/products';
import { getProductFormRefs } from '@/lib/admin/products';
import { formatCurrency } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import PageHeader from '@/components/admin/PageHeader';
import type { PricingMode } from '@prisma/client';

export const dynamic = 'force-dynamic';

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; mode?: string; status?: string; page?: string }>;
}) {
  await requirePermission('products.manage');
  const sp = await searchParams;
  const [{ categories }, result] = await Promise.all([
    getProductFormRefs(),
    listProducts({
      q: sp.q,
      categoryId: sp.category,
      pricingMode: (sp.mode as PricingMode) || undefined,
      status: sp.status === 'inactive' ? 'inactive' : sp.status === 'active' ? 'active' : undefined,
      page: sp.page ? Number(sp.page) : 1,
    }),
  ]);

  return (
    <div>
      <PageHeader title="Products" description={`${result.total} products`} action={{ label: 'New product', href: '/admin/products/new' }} />
      <div className="mb-4 -mt-2">
        <Link href="/admin/products/import" className="text-sm underline decoration-line-strong underline-offset-4 hover:text-brass">Bulk import CSV</Link>
      </div>

      {/* Filters */}
      <form className="mb-4 flex flex-wrap gap-2 text-sm" action="/admin/products">
        <input name="q" defaultValue={sp.q} placeholder="Search name / SKU / slug" className="border border-line px-3 py-2 outline-none focus:border-brass min-w-[200px]" />
        <select name="category" defaultValue={sp.category ?? ''} className="border border-line px-3 py-2 outline-none focus:border-brass">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select name="mode" defaultValue={sp.mode ?? ''} className="border border-line px-3 py-2 outline-none focus:border-brass">
          <option value="">All pricing</option>
          <option value="WEIGHT_BASED">Weight</option>
          <option value="COMPONENT_BASED">Component</option>
          <option value="FIXED">Fixed</option>
        </select>
        <select name="status" defaultValue={sp.status ?? ''} className="border border-line px-3 py-2 outline-none focus:border-brass">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button className="btn-outline text-xs">Filter</button>
      </form>

      {result.items.length === 0 ? (
        <div className="border border-line bg-white p-10 text-center">
          <p className="font-heading text-lg">No products found</p>
          <p className="text-sm text-ink-soft mt-1">Adjust filters or create a new product.</p>
          <Link href="/admin/products/new" className="btn-primary mt-4 inline-flex">New product</Link>
        </div>
      ) : (
        <div className="border border-line bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-soft border-b border-line">
                <th className="px-4 py-2 font-medium">Product</th>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">Pricing</th>
                <th className="px-4 py-2 font-medium">Price range</th>
                <th className="px-4 py-2 font-medium">Variants</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((p) => (
                <tr key={p.id} className="border-b border-line/60 hover:bg-paper-2/40">
                  <td className="px-4 py-2">
                    <Link href={`/admin/products/${p.id}`} className="font-medium hover:text-brass">{p.name}</Link>
                    <div className="text-xs text-ink-soft">{p.sku}</div>
                  </td>
                  <td className="px-4 py-2 text-ink-soft">{p.categoryName}</td>
                  <td className="px-4 py-2 text-ink-soft">{p.pricingMode.replace('_', ' ').toLowerCase()}</td>
                  <td className="px-4 py-2">
                    {p.priceFrom ? (p.priceFrom === p.priceTo ? formatCurrency(p.priceFrom) : `${formatCurrency(p.priceFrom)} – ${formatCurrency(p.priceTo)}`) : <span className="text-ink-soft">—</span>}
                  </td>
                  <td className="px-4 py-2 text-ink-soft">{p.variantCount}</td>
                  <td className="px-4 py-2">
                    <span className={cn('text-xs px-2 py-0.5 rounded-[2px] border', p.isActive ? 'border-velvet text-velvet' : 'border-line text-ink-soft')}>
                      {p.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {result.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-ink-soft">Page {result.page} of {result.totalPages}</span>
          <div className="flex gap-2">
            {result.page > 1 && <PageLink sp={sp} page={result.page - 1} label="Previous" />}
            {result.page < result.totalPages && <PageLink sp={sp} page={result.page + 1} label="Next" />}
          </div>
        </div>
      )}
    </div>
  );
}

function PageLink({ sp, page, label }: { sp: Record<string, string | undefined>; page: number; label: string }) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v && k !== 'page') params.set(k, v);
  params.set('page', String(page));
  return <Link href={`/admin/products?${params.toString()}`} className="btn-outline text-xs">{label}</Link>;
}
