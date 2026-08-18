import { requireStaff } from '@/lib/auth/guard';
import { navForRole } from '@/lib/admin/nav';
import { ROLE_LABELS } from '@/lib/auth/rbac';
import { getStoreSettings } from '@/lib/store';
import AdminSidebar from '@/components/admin/AdminSidebar';

// Every route under this layout is guarded: unauthenticated staff are redirected
// to the login page, and the sidebar is filtered to the role's permissions.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const staff = await requireStaff();
  const [store] = await Promise.all([getStoreSettings()]);
  const sections = navForRole(staff.role);

  return (
    <div className="min-h-screen bg-paper font-body lg:flex">
      <AdminSidebar
        sections={sections}
        brandName={store.brandName}
        userName={staff.name ?? staff.email ?? 'Staff'}
        roleLabel={ROLE_LABELS[staff.role]}
      />
      <div className="flex-1 min-w-0">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
          {children}
        </div>
      </div>
    </div>
  );
}
