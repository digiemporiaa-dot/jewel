import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can, canAny, type Permission } from '@/lib/auth/rbac';
import type { Role } from '@prisma/client';

export type StaffSession = {
  id: string;
  name?: string | null;
  email?: string | null;
  role: Role;
};

/**
 * Require an authenticated staff user. Redirects to the admin login otherwise.
 * Use at the top of every admin server component / layout.
 */
export async function requireStaff(): Promise<StaffSession> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/admin/login');
  }
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: session.user.role,
  };
}

/**
 * Require a specific permission. Redirects unauthorized staff to the admin home
 * (with a denied flag). This is the authoritative check — server-side only.
 */
export async function requirePermission(permission: Permission): Promise<StaffSession> {
  const staff = await requireStaff();
  if (!can(staff.role, permission)) {
    redirect('/admin?denied=1');
  }
  return staff;
}

export async function requireAnyPermission(
  permissions: Permission[]
): Promise<StaffSession> {
  const staff = await requireStaff();
  if (!canAny(staff.role, permissions)) {
    redirect('/admin?denied=1');
  }
  return staff;
}

/**
 * Assert a permission inside a server action. Throws (rather than redirects) so
 * the mutation aborts loudly. Never rely on hidden UI for protection.
 */
export async function assertPermission(permission: Permission): Promise<StaffSession> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error('Unauthorized: authentication required');
  }
  if (!can(session.user.role, permission)) {
    throw new Error(`Forbidden: missing permission "${permission}"`);
  }
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: session.user.role,
  };
}
