'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { assertPermission } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { PublishStatus } from '@prisma/client';

export type Result = { ok: boolean; error?: string };

const postSchema = z.object({
  title: z.string().trim().min(2, 'Title is required').max(160),
  slug: z.string().trim().min(2).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens'),
  author: z.string().trim().min(2, 'Author is required').max(80),
  category: z.string().trim().max(60).optional().or(z.literal('')),
  tags: z.string().trim().max(200).optional().or(z.literal('')),
  featuredImage: z.string().trim().max(500).optional().or(z.literal('')),
  excerpt: z.string().trim().max(320).optional().or(z.literal('')),
  content: z.string().trim().min(10, 'Content is required').max(40000),
  status: z.nativeEnum(PublishStatus),
  publishedAt: z.string().optional().or(z.literal('')),
  seoTitle: z.string().trim().max(160).optional().or(z.literal('')),
  seoDescription: z.string().trim().max(320).optional().or(z.literal('')),
});

function toData(d: z.infer<typeof postSchema>) {
  return {
    title: d.title, slug: d.slug, author: d.author,
    category: d.category || null,
    tags: d.tags ? d.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    featuredImage: d.featuredImage || null,
    excerpt: d.excerpt || null,
    content: d.content,
    status: d.status,
    publishedAt: d.status === PublishStatus.PUBLISHED ? (d.publishedAt ? new Date(d.publishedAt) : new Date()) : null,
    seoTitle: d.seoTitle || null,
    seoDescription: d.seoDescription || null,
  };
}

export async function createPostAction(fd: FormData): Promise<Result> {
  const staff = await assertPermission('blog.manage');
  const parsed = postSchema.safeParse(Object.fromEntries(fd.entries()));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const exists = await prisma.blogPost.findUnique({ where: { slug: parsed.data.slug }, select: { id: true } });
  if (exists) return { ok: false, error: 'That slug is already in use' };

  const post = await prisma.blogPost.create({ data: toData(parsed.data) });
  await writeAudit({ userId: staff.id, action: 'BLOG_CREATE', entity: 'BlogPost', entityId: post.id, after: { slug: parsed.data.slug } });
  revalidatePath('/admin/blog');
  revalidatePath('/blog');
  redirect(`/admin/blog/${post.id}`);
}

export async function updatePostAction(id: string, fd: FormData): Promise<Result> {
  const staff = await assertPermission('blog.manage');
  const parsed = postSchema.safeParse(Object.fromEntries(fd.entries()));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const clash = await prisma.blogPost.findFirst({ where: { slug: parsed.data.slug, id: { not: id } }, select: { id: true } });
  if (clash) return { ok: false, error: 'That slug is already in use' };

  await prisma.blogPost.update({ where: { id }, data: toData(parsed.data) });
  await writeAudit({ userId: staff.id, action: 'BLOG_UPDATE', entity: 'BlogPost', entityId: id });
  revalidatePath('/admin/blog');
  revalidatePath('/blog');
  revalidatePath(`/blog/${parsed.data.slug}`);
  return { ok: true };
}

export async function deletePostAction(id: string): Promise<Result> {
  const staff = await assertPermission('blog.manage');
  await prisma.blogPost.delete({ where: { id } });
  await writeAudit({ userId: staff.id, action: 'BLOG_DELETE', entity: 'BlogPost', entityId: id });
  revalidatePath('/admin/blog');
  revalidatePath('/blog');
  redirect('/admin/blog');
}
