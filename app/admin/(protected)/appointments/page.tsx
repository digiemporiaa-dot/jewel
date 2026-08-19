import Link from 'next/link';
import { requirePermission } from '@/lib/auth/guard';
import { listAppointments } from '@/lib/appointments';
import { getSalesStaff } from '@/lib/admin/crm';
import { formatDate } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import PageHeader from '@/components/admin/PageHeader';
import AppointmentRow from './AppointmentRow';
import { AppointmentStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

export default async function AdminAppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; all?: string }>;
}) {
  await requirePermission('appointments.manage');
  const sp = await searchParams;
  const status = sp.status && sp.status in AppointmentStatus ? (sp.status as AppointmentStatus) : undefined;
  const upcomingOnly = sp.all !== '1';

  const [appointments, staff] = await Promise.all([
    listAppointments({ status, upcomingOnly }),
    getSalesStaff(),
  ]);

  return (
    <div>
      <PageHeader title="Appointments" description={`${appointments.length} ${upcomingOnly ? 'upcoming' : 'total'}`} />

      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <Link href="/admin/appointments" className={cn('btn-outline', upcomingOnly && !status && 'border-brass text-brass')}>Upcoming</Link>
        <Link href="/admin/appointments?all=1" className={cn('btn-outline', sp.all === '1' && !status && 'border-brass text-brass')}>All</Link>
        {Object.values(AppointmentStatus).map((s) => (
          <Link key={s} href={`/admin/appointments?status=${s}&all=1`} className={cn('btn-outline', status === s && 'border-brass text-brass')}>
            {s.replace('_', ' ')}
          </Link>
        ))}
      </div>

      {appointments.length === 0 ? (
        <div className="border border-line bg-white p-10 text-center">
          <p className="font-heading text-lg">No appointments</p>
          <p className="text-sm text-ink-soft mt-1">Bookings from /appointments appear here.</p>
        </div>
      ) : (
        <div className="border border-line bg-white divide-y divide-line/60">
          {appointments.map((a) => (
            <div key={a.id} className="px-4 py-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-sm">
                  {a.name} <span className="text-xs text-ink-soft">· {a.phone}{a.email ? ` · ${a.email}` : ''}</span>
                </p>
                <p className="text-xs text-ink-soft">
                  {formatDate(a.date)} · {a.slot} · {a.type.replace('_', ' ').toLowerCase()}
                  {a.product ? ` · interested in ${a.product.name}` : ''}
                </p>
                {a.notes && <p className="text-xs mt-0.5">{a.notes}</p>}
                {a.customer && (
                  <Link href={`/admin/customers/${a.customer.id}`} className="text-xs underline underline-offset-2 hover:text-brass">View customer</Link>
                )}
              </div>
              <AppointmentRow appointment={{ id: a.id, status: a.status, staffId: a.staffId }} staff={staff} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
