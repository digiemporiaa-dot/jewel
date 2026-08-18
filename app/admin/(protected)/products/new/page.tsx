import { requirePermission } from '@/lib/auth/guard';
import { getProductFormRefs } from '@/lib/admin/products';
import PageHeader from '@/components/admin/PageHeader';
import ProductForm from '../ProductForm';
import { createProductAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function NewProductPage() {
  await requirePermission('products.manage');
  const refs = await getProductFormRefs();

  return (
    <div>
      <PageHeader title="New product" description="A default variant is created automatically; add stock and images after saving." />
      <ProductForm action={createProductAction} refs={refs} submitLabel="Create product" />
    </div>
  );
}
