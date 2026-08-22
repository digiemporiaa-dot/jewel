import 'server-only';
import { prisma } from '@/lib/prisma';
import type { CouponRefs } from './CouponForm';

/** Scoping options, loaded from live catalogue data. */
export async function getCouponRefs(): Promise<CouponRefs> {
  const [categories, collections, metals, purities] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { order: 'asc' } }),
    prisma.collection.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { order: 'asc' } }),
    prisma.metal.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
    prisma.purity.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
  ]);
  return {
    categories,
    collections,
    metals: metals.map((m) => m.name),
    purities: [...new Set(purities.map((p) => p.name))],
  };
}
