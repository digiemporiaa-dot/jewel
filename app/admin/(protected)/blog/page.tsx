import Link from 'next/link';
import { requirePermission } from '@/lib/auth/guard';
import { listAllPosts } from '@/lib/cms';
import { formatDate } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import PageHeader from '@/components/admin/PageHeader';

export const dynamic = 'force-dynamic';

export default async function AdminBlogPage() {
  await requirePermission('blog.manage');
  const posts = await listAllPosts();

  return (
    <div>
      <PageHeader title="Blog" description={`${posts.length} posts`} action={{ label: 'New post', href: '/admin/blog/new' }} />
      {posts.length === 0 ? (
        <div className="border border-line bg-white p-10 text-center">
          <p className="font-heading text-lg">No posts yet</p>
          <Link href="/admin/blog/new" className="btn-primary mt-4 inline-flex">Write your first post</Link>
        </div>
      ) : (
        <div className="border border-line bg-white divide-y divide-line/60">
          {posts.map((p) => (
            <div key={p.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/admin/blog/${p.id}`} className="font-medium text-sm hover:text-brass">{p.title}</Link>
                <p className="text-xs text-ink-soft">/blog/{p.slug} · {p.author}{p.category ? ` · ${p.category}` : ''}</p>
              </div>
              <div className="text-right shrink-0">
                <span className={cn('text-xs px-2 py-0.5 border rounded-[2px]', p.status === 'PUBLISHED' ? 'border-velvet text-velvet' : 'border-line text-ink-soft')}>{p.status}</span>
                <p className="text-xs text-ink-soft mt-0.5">{formatDate(p.publishedAt ?? p.updatedAt)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
