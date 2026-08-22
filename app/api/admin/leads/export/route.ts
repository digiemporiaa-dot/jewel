import { auth } from '@/auth';
import { can } from '@/lib/auth/rbac';
import { writeAudit } from '@/lib/audit';
import { toCsv } from '@/lib/csv';
import { leadsForExport, LEAD_EXPORT_LIMIT } from '@/lib/admin/crm';
import { resolveRange } from '@/lib/admin/date-range';
import { LeadStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

/**
 * CSV of the leads currently on screen, under the same filters.
 *
 * The ownership scope goes through unchanged: a sales executive who can only see
 * their own leads on the page exports only their own leads. An export route that
 * forgets the scope is a way to read the whole pipeline through a URL.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !can(session.user.role, 'crm.access')) {
    return new Response('Unauthorized', { status: 401 });
  }

  const scope = { userId: session.user.id, assignedOnly: !can(session.user.role, 'orders.manage') };

  const url = new URL(request.url);
  const get = (key: string) => url.searchParams.get(key) ?? undefined;
  const statusParam = get('status');
  const range = resolveRange({ preset: get('preset'), from: get('from'), to: get('to') });

  const leads = await leadsForExport(scope, {
    status: statusParam && statusParam in LeadStatus ? (statusParam as LeadStatus) : undefined,
    q: get('q'),
    range,
  });

  const csv = toCsv(
    ['Created', 'Name', 'Phone', 'Email', 'Source', 'Status', 'Interested in', 'Estimated value', 'Times asked', 'Assigned to', 'Notes'],
    leads.map((l) => ({
      Created: l.createdAt.toISOString(),
      Name: l.name ?? '',
      Phone: l.phone ?? '',
      Email: l.email ?? '',
      Source: l.source,
      Status: l.status,
      'Interested in': l.product?.name ?? '',
      'Estimated value': l.estimatedValue?.toString() ?? '',
      'Times asked': l.touchCount,
      'Assigned to': l.assignedTo?.name ?? '',
      Notes: l.notes ?? '',
    }))
  );

  await writeAudit({
    userId: session.user.id,
    action: 'LEADS_EXPORT',
    entity: 'Lead',
    entityId: 'export',
    after: { range: range.label, rows: leads.length, truncated: leads.length === LEAD_EXPORT_LIMIT, ownOnly: scope.assignedOnly },
  });

  const name = `leads-${range.fromKey ?? 'all'}-to-${range.toKey ?? 'all'}.csv`;
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
