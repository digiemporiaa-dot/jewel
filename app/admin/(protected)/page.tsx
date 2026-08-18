import { requirePermission } from '@/lib/auth/guard';
import { getDashboardStats } from '@/lib/admin/dashboard';
import { formatCurrency, formatNumber } from '@/lib/utils/format';
import StatCard from '@/components/admin/StatCard';

export const dynamic = 'force-dynamic';

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const staff = await requirePermission('dashboard.view');
  const { denied } = await searchParams;
  const stats = await getDashboardStats();

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-heading text-2xl">Dashboard</h1>
        <p className="text-sm text-ink-soft">
          Welcome back, {staff.name ?? 'there'}.
        </p>
      </header>

      {denied && (
        <div className="mb-6 border border-line-strong bg-paper-2 px-4 py-3 text-sm">
          You don&apos;t have permission to access that section.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
        <StatCard label="Orders Today" value={formatNumber(stats.ordersToday)} />
        <StatCard label="Sales Today" value={formatCurrency(stats.salesToday)} />
        <StatCard label="Pending Payments" value={formatNumber(stats.pendingPayments)} />
        <StatCard label="Pending Dispatch" value={formatNumber(stats.pendingDispatch)} />
        <StatCard label="New Customers" value={formatNumber(stats.newCustomersToday)} hint="today" />
        <StatCard label="New Leads" value={formatNumber(stats.newLeads)} />
        <StatCard label="Appointments" value={formatNumber(stats.upcomingAppointments)} hint="upcoming" />
        <StatCard label="Low Stock" value={formatNumber(stats.lowStock)} />
        <StatCard label="Abandoned Carts" value={formatNumber(stats.abandonedCarts)} />
      </div>

      <div className="mt-8 border border-line bg-white p-6">
        <h2 className="font-heading text-lg">Phase 1 foundation</h2>
        <p className="mt-2 text-sm text-ink-soft max-w-2xl">
          Authentication, role-based navigation and the store data model are live.
          Catalog management, the pricing engine, storefront, checkout, shipping and
          CRM are delivered in subsequent phases. Sections you can access are listed
          in the sidebar, filtered to your role.
        </p>
      </div>
    </div>
  );
}
