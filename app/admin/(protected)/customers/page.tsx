import Link from 'next/link';
import { requirePermission } from '@/lib/auth/guard';
import { listCustomers } from '@/lib/admin/crm';
import { formatDate } from '@/lib/utils/format';
import PageHeader from '@/components/admin/PageHeader';
import ArchiveToggle from '@/components/admin/ArchiveToggle';
import { Gender } from '@prisma/client';
import { GENDER_LABELS, GENDERS, GAP_LABELS, profileGaps } from '@/lib/validations/signup';
import { formatIndianMobile } from '@/lib/validations/phone';

export const dynamic = 'force-dynamic';

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; deleted?: string; gender?: string; incomplete?: string }>;
}) {
  await requirePermission('customers.view');
  const sp = await searchParams;
  const deleted = sp.deleted === '1';
  // Validated against the enum rather than passed through: a query string is
  // caller-supplied, and Prisma would throw on anything that is not a member.
  const gender = parseGenderFilter(sp.gender);
  const incomplete = sp.incomplete === '1';
  const result = await listCustomers({ q: sp.q, page: sp.page ? Number(sp.page) : 1, deleted, gender, incomplete });

  return (
    <div>
      <PageHeader title="Customers" description={`${result.total} customers`} />

      <ArchiveToggle
        basePath="/admin/customers"
        param="deleted"
        params={{ q: sp.q }}
        active={deleted}
        liveLabel="Customers"
        archivedLabel="Removed"
      />

      <form className="mb-4 flex gap-2 text-sm" action="/admin/customers">
        {deleted && <input type="hidden" name="deleted" value="1" />}
        <input name="q" defaultValue={sp.q} placeholder="Search name / phone / email" className="border border-line px-3 py-2 outline-none focus:border-brass min-w-[240px]" />
        <select name="gender" defaultValue={gender ?? ''} className="border border-line px-3 py-2 outline-none focus:border-brass">
          <option value="">Any gender</option>
          {GENDERS.map((g) => (
            <option key={g} value={g}>{GENDER_LABELS[g]}</option>
          ))}
          {/* Its own option, because it is the segment the profile prompt is
              trying to reach — not an absence to hide. */}
          <option value="UNKNOWN">Not recorded</option>
        </select>
        {/* Both identifiers are required by every form now, so a row missing one
            was created before the rule — by the old phone-only checkout, or by
            the wheel, which asks for a number and nothing else. This is the
            list to chase, so it gets a control rather than a saved query. */}
        <label className="flex items-center gap-2 px-2 text-xs text-ink-soft">
          <input type="checkbox" name="incomplete" value="1" defaultChecked={incomplete} />
          Missing email or phone
        </label>
        <button className="btn-outline text-xs">Search</button>
      </form>

      {result.items.length === 0 ? (
        <div className="border border-line bg-white p-10 text-center">
          <p className="font-heading text-lg">No customers yet</p>
          <p className="text-sm text-ink-soft mt-1">Customers appear after their first OTP sign-in or order.</p>
        </div>
      ) : (
        <div className="border border-line bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-soft border-b border-line">
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Contact</th>
                <th className="px-4 py-2 font-medium">Gender</th>
                <th className="px-4 py-2 font-medium">Orders</th>
                <th className="px-4 py-2 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((c) => (
                <tr key={c.id} className="border-b border-line/60 hover:bg-paper-2/40">
                  <td className="px-4 py-2">
                    <Link href={`/admin/customers/${c.id}`} className="font-medium hover:text-brass">{c.name ?? 'Guest customer'}</Link>
                  </td>
                  <td className="px-4 py-2 text-ink-soft">
                    {/* Stored as ten digits, shown the way it is written. */}
                    <div>{c.phone ? formatIndianMobile(c.phone) : <MissingValue>No phone</MissingValue>}</div>
                    <div className="text-xs">{c.email ?? <MissingValue>No email</MissingValue>}</div>
                    <MissingBadges customer={c} />
                  </td>
                  <td className="px-4 py-2 text-ink-soft">{c.gender ? GENDER_LABELS[c.gender] : '—'}</td>
                  <td className="px-4 py-2">{c._count.orders}</td>
                  <td className="px-4 py-2 text-ink-soft">{formatDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.totalPages > 1 && (
        <div className="mt-4 flex justify-between text-sm">
          <span className="text-ink-soft">Page {result.page} of {result.totalPages}</span>
          <div className="flex gap-2">
            {result.page > 1 && <Link href={`/admin/customers?page=${result.page - 1}`} className="btn-outline text-xs">Previous</Link>}
            {result.page < result.totalPages && <Link href={`/admin/customers?page=${result.page + 1}`} className="btn-outline text-xs">Next</Link>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Read the gender filter off the query string.
 *
 * Validated against the enum rather than passed through: a query string is
 * whatever somebody typed into the address bar, and Prisma throws on a value
 * that is not a member of the type.
 */
function parseGenderFilter(value: string | undefined): Gender | 'UNKNOWN' | undefined {
  if (!value) return undefined;
  if (value === 'UNKNOWN') return 'UNKNOWN';
  return (GENDERS as readonly string[]).includes(value) ? (value as Gender) : undefined;
}

/** A field the record does not have, said plainly rather than left as a dash. */
function MissingValue({ children }: { children: React.ReactNode }) {
  return <span className="text-brass">{children}</span>;
}

/**
 * What is still missing from this record.
 *
 * Shown on the row rather than only behind the filter, so the gap is visible
 * to whoever is already looking at the customer instead of only to whoever
 * thought to go looking for gaps.
 */
function MissingBadges({
  customer,
}: {
  customer: { name: string | null; email: string | null; phone: string | null; dob: Date | null; gender: Gender | null };
}) {
  const gaps = profileGaps(customer).filter((g) => g !== 'email' && g !== 'phone');
  if (gaps.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {gaps.map((g) => (
        <span key={g} className="border border-line px-1.5 py-0.5 text-[0.6rem] text-ink-soft">
          no {GAP_LABELS[g].replace(/^your /, '').replace(/^how you would like to be addressed$/, 'gender')}
        </span>
      ))}
    </div>
  );
}
