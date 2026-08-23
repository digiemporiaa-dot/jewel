import { cn } from '@/lib/utils/cn';
import { formatAge, type HealthCheck } from '@/lib/system/health';
import type { JobStatus } from '@/lib/system/jobs';

/**
 * What is quietly not working, on the first screen an operator opens.
 *
 * Everything listed here fails without an error: no SMTP means order
 * confirmations are simply never sent; no scheduler means the shop keeps selling
 * at whatever gold rate was last typed in. Both look exactly like a healthy shop
 * from every other screen, which is why this one exists.
 */
export default function SystemHealth({
  checks, jobs,
}: {
  checks: HealthCheck[];
  jobs: JobStatus[];
}) {
  const problems = checks.filter((c) => c.severity !== 'ok');
  if (problems.length === 0) {
    return (
      <section className="mb-6 border border-line bg-white px-4 py-3 text-sm">
        <span className="text-velvet">Everything is configured — email, scheduler, rates, payments and sign-in.</span>
      </section>
    );
  }

  const critical = problems.filter((c) => c.severity === 'critical');

  return (
    <section className={cn('mb-6 border', critical.length > 0 ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50')}>
      <div className="border-b border-inherit px-4 py-2.5">
        <h2 className="font-heading text-base">
          {critical.length > 0
            ? `${critical.length} thing${critical.length === 1 ? '' : 's'} that will not work`
            : 'Worth checking'}
        </h2>
        <p className="text-xs text-ink-soft">
          These fail silently — nothing else on any screen would tell you.
        </p>
      </div>

      <ul className="divide-y divide-inherit">
        {problems.map((c) => (
          <li key={c.id} className="px-4 py-3 text-sm">
            <p className={cn('font-medium', c.severity === 'critical' ? 'text-red-800' : 'text-amber-900')}>
              {c.label}
            </p>
            <p className="mt-0.5 text-ink-soft">{c.detail}</p>
            {c.fix && <p className="mt-1 text-xs text-ink">{c.fix}</p>}
          </li>
        ))}
      </ul>

      <div className="border-t border-inherit px-4 py-2.5">
        <p className="text-xs tracking-[0.1em] uppercase text-ink-soft">Scheduled jobs</p>
        <ul className="mt-1.5 grid gap-1 sm:grid-cols-2">
          {jobs.map((j) => (
            <li key={j.name} className="flex items-baseline justify-between gap-3 text-xs">
              <span>{j.label}</span>
              <span
                className={cn(
                  j.health === 'ok' && 'text-velvet',
                  j.health === 'late' && 'text-amber-800',
                  (j.health === 'failing' || j.health === 'never') && 'text-red-700'
                )}
              >
                {j.health === 'never' ? 'never run' : `${formatAge(j.minutesSince)} ago`}
                {j.runCount > 0 && ` · ${j.runCount} run${j.runCount === 1 ? '' : 's'}`}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
