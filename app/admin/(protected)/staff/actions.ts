'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { assertPermission } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { Role } from '@prisma/client';

export type Result = { ok: boolean; error?: string };

const createSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(80),
  email: z.string().trim().email('Enter a valid email').max(160),
  password: z.string().min(10, 'Use at least 10 characters').max(200),
  role: z.nativeEnum(Role),
});

/** Create a staff account. `staff.manage` is SUPER_ADMIN-only (see rbac.ts). */
export async function createStaffAction(fd: FormData): Promise<Result> {
  const actor = await assertPermission('staff.manage');
  const parsed = createSchema.safeParse(Object.fromEntries(fd.entries()));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;

  const exists = await prisma.user.findUnique({ where: { email: d.email.toLowerCase() }, select: { id: true } });
  if (exists) return { ok: false, error: 'That email is already in use' };

  const user = await prisma.user.create({
    data: {
      name: d.name,
      email: d.email.toLowerCase(),
      passwordHash: await bcrypt.hash(d.password, 10),
      role: d.role,
    },
  });
  // Never log the password — only who was created and with what role.
  await writeAudit({ userId: actor.id, action: 'STAFF_CREATE', entity: 'User', entityId: user.id, after: { email: user.email, role: user.role } });
  revalidatePath('/admin/staff');
  return { ok: true };
}

const updateSchema = z.object({
  id: z.string().min(1),
  role: z.nativeEnum(Role),
  isActive: z.coerce.boolean(),
});

export async function updateStaffAction(id: string, role: string, isActive: boolean): Promise<Result> {
  const actor = await assertPermission('staff.manage');
  const parsed = updateSchema.safeParse({ id, role, isActive });
  if (!parsed.success) return { ok: false, error: 'Invalid input' };

  // Guard: never let the last active SUPER_ADMIN be demoted or disabled.
  const target = await prisma.user.findUnique({ where: { id }, select: { role: true, isActive: true } });
  if (!target) return { ok: false, error: 'Staff member not found' };

  const losingSuper = target.role === Role.SUPER_ADMIN && (parsed.data.role !== Role.SUPER_ADMIN || !parsed.data.isActive);
  if (losingSuper) {
    const remaining = await prisma.user.count({ where: { role: Role.SUPER_ADMIN, isActive: true, id: { not: id } } });
    if (remaining === 0) return { ok: false, error: 'At least one active super admin is required' };
  }

  await prisma.user.update({ where: { id }, data: { role: parsed.data.role, isActive: parsed.data.isActive } });
  await writeAudit({
    userId: actor.id, action: 'STAFF_PERMISSION_CHANGE', entity: 'User', entityId: id,
    before: { role: target.role, isActive: target.isActive },
    after: { role: parsed.data.role, isActive: parsed.data.isActive },
  });
  revalidatePath('/admin/staff');
  return { ok: true };
}

export async function resetStaffPasswordAction(id: string, password: string): Promise<Result> {
  const actor = await assertPermission('staff.manage');
  const parsed = z.string().min(10, 'Use at least 10 characters').max(200).safeParse(password);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid password' };

  await prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(parsed.data, 10) } });
  // The new password is never written to the audit log.
  await writeAudit({ userId: actor.id, action: 'STAFF_PASSWORD_RESET', entity: 'User', entityId: id });
  revalidatePath('/admin/staff');
  return { ok: true };
}
