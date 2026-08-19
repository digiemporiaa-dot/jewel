import { requirePermission } from '@/lib/auth/guard';
import PageHeader from '@/components/admin/PageHeader';
import PostForm from '../PostForm';

export const dynamic = 'force-dynamic';

export default async function NewPostPage() {
  await requirePermission('blog.manage');
  return (
    <div>
      <PageHeader title="New post" action={{ label: 'Back to blog', href: '/admin/blog' }} />
      <PostForm />
    </div>
  );
}
