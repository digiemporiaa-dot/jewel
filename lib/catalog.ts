import { cache } from 'react';
import { prisma } from '@/lib/prisma';

/** Top-level active categories for homepage / nav shortcuts. */
export const getTopCategories = cache(async (limit = 8) => {
  try {
    return await prisma.category.findMany({
      where: { isActive: true, parentId: null },
      orderBy: { order: 'asc' },
      take: limit,
      select: { id: true, name: true, slug: true, imageUrl: true },
    });
  } catch {
    return [];
  }
});

/** Active collections for homepage bands. */
export const getActiveCollections = cache(async (limit = 6) => {
  try {
    return await prisma.collection.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
      take: limit,
      select: { id: true, name: true, slug: true, imageUrl: true, description: true },
    });
  } catch {
    return [];
  }
});
