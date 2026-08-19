import { requirePermission } from '@/lib/auth/guard';
import PageHeader from '@/components/admin/PageHeader';
import PageForm from '../PageForm';

export const dynamic = 'force-dynamic';

export default async function NewCmsPage() {
  await requirePermission('cms.manage');
  return (
    <div>
      <PageHeader title="New page" description="Create the page, then add content blocks." action={{ label: 'Back to CMS', href: '/admin/cms' }} />
      <PageForm />
    </div>
  );
}
