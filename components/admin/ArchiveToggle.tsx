import { cn } from '@/lib/utils/cn';
import { withParams } from '@/lib/admin/date-range';

/**
 * Switches a list between what is live and what has been removed.
 *
 * The archive is what makes soft deletion honest. Removing something that
 * quietly cannot be found again is a delete with extra steps; being able to see
 * it, and put it back, is the difference.
 *
 * Plain anchors, like the date presets — soft navigation to the same route with
 * a different query is unreliable here.
 */
export default function ArchiveToggle({
  basePath, param, params, active, liveLabel, archivedLabel, count,
}: {
  basePath: string;
  /** `deleted` for products and customers, `archived` for orders. */
  param: 'deleted' | 'archived';
  params: Record<string, string | undefined>;
  active: boolean;
  liveLabel: string;
  archivedLabel: string;
  count?: number;
}) {
  const href = (on: boolean) =>
    `${basePath}${withParams(params, { [param]: on ? '1' : null, page: null })}`;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
      <a href={href(false)} className={cn('border px-2.5 py-1', !active ? 'border-brass bg-brass/10 text-ink' : 'border-line text-ink-soft hover:border-brass')}>
        {liveLabel}
      </a>
      <a href={href(true)} className={cn('border px-2.5 py-1', active ? 'border-brass bg-brass/10 text-ink' : 'border-line text-ink-soft hover:border-brass')}>
        {archivedLabel}{count !== undefined && count > 0 ? ` (${count})` : ''}
      </a>
      {active && (
        <span className="text-ink-soft">
          Nothing here has been erased. Restore anything you need back.
        </span>
      )}
    </div>
  );
}
