import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth/guard';
import { getPostForEdit } from '@/lib/cms';
import PageHeader from '@/components/admin/PageHeader';
import PostForm from '../PostForm';

export const dynamic = 'force-dynamic';

function toLocalInput(d: Date | null): string {
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('blog.manage');
  const { id } = await params;
  const post = await getPostForEdit(id);
  if (!post) notFound();

  return (
    <div>
      <PageHeader title={post.title} description={`/blog/${post.slug}`} action={{ label: 'Back to blog', href: '/admin/blog' }} />
      <Link href={`/blog/${post.slug}`} className="text-sm underline underline-offset-4 hover:text-brass mb-4 inline-block">View on storefront</Link>
      <PostForm
        defaults={{
          id: post.id, title: post.title, slug: post.slug, author: post.author,
          category: post.category ?? '', tags: post.tags.join(', '),
          featuredImage: post.featuredImage ?? '', excerpt: post.excerpt ?? '',
          content: post.content, status: post.status,
          publishedAt: toLocalInput(post.publishedAt),
          seoTitle: post.seoTitle ?? '', seoDescription: post.seoDescription ?? '',
          ogImageUrl: post.ogImageUrl ?? '', canonicalUrl: post.canonicalUrl ?? '', noIndex: post.noIndex,
        }}
      />
    </div>
  );
}
