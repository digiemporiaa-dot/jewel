import 'server-only';
import { prisma } from '@/lib/prisma';

/**
 * The scheduled jobs, and what "healthy" means for each.
 *
 * Nothing in this application can schedule itself. Something outside the
 * container — Coolify, cron, a GitHub Action, Vercel Cron — has to call these
 * endpoints. When nobody has configured that, the shop does not break loudly: it
 * keeps selling at whatever metal rate was last typed in by hand, and the
 * abandoned-cart, birthday, back-in-stock and price-drop mail is simply never
 * sent. Nothing on any screen says so.
 *
 * `expectedEveryMinutes` is what turns silence into a warning.
 */

export type JobName =
  | 'recompute-prices'
  | 'abandoned-cart'
  | 'campaigns'
  | 'shipment-reconciliation';

export const JOBS: {
  name: JobName;
  label: string;
  /** How often a scheduler should call it. */
  expectedEveryMinutes: number;
  /** What silently stops working when it does not run. */
  consequence: string;
}[] = [
  {
    name: 'recompute-prices',
    label: 'Recompute prices',
    expectedEveryMinutes: 60,
    consequence: 'Every price on the site is derived from the last metal rate entered. Without this the catalogue keeps selling at a stale rate.',
  },
  {
    name: 'abandoned-cart',
    label: 'Abandoned cart reminders',
    expectedEveryMinutes: 60,
    consequence: 'Shoppers who left a bag behind are never reminded, and no abandoned-cart lead reaches the sales team.',
  },
  {
    name: 'campaigns',
    label: 'Campaigns and notifications',
    expectedEveryMinutes: 24 * 60,
    consequence: 'Birthday and anniversary greetings are not sent.',
  },
  {
    name: 'shipment-reconciliation',
    label: 'Shipment reconciliation',
    expectedEveryMinutes: 6 * 60,
    consequence: 'Courier statuses are only updated when a webhook happens to arrive; a missed webhook leaves an order stuck.',
  },
];

/**
 * Record a run. Best-effort and deliberately swallowing its own errors — the
 * bookkeeping must never be the reason a job reports failure.
 */
export async function recordJobRun(
  name: JobName,
  status: 'ok' | 'failed',
  message: string | null,
  durationMs: number
): Promise<void> {
  try {
    await prisma.jobRun.upsert({
      where: { name },
      create: { name, lastRunAt: new Date(), lastStatus: status, lastMessage: message, lastDurationMs: durationMs, runCount: 1 },
      update: { lastRunAt: new Date(), lastStatus: status, lastMessage: message, lastDurationMs: durationMs, runCount: { increment: 1 } },
    });
  } catch (e) {
    console.error('[jobs] could not record the run of', name, e);
  }
}

/**
 * Wrap a cron handler so every run is recorded, whether it succeeds or throws.
 *
 * The failure case matters as much as the success one: a job running hourly and
 * failing every time looks identical to a healthy one if only successes are
 * written down.
 */
export async function runJob<T>(name: JobName, work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    const result = await work();
    await recordJobRun(name, 'ok', summarise(result), Date.now() - started);
    return result;
  } catch (e) {
    await recordJobRun(name, 'failed', e instanceof Error ? e.message.slice(0, 300) : 'Unknown error', Date.now() - started);
    throw e;
  }
}

function summarise(result: unknown): string | null {
  if (result === null || result === undefined) return null;
  if (typeof result === 'number') return String(result);
  if (typeof result === 'object') {
    try {
      return JSON.stringify(result).slice(0, 300);
    } catch {
      return null;
    }
  }
  return String(result).slice(0, 300);
}

export type JobStatus = {
  name: JobName;
  label: string;
  consequence: string;
  lastRunAt: Date | null;
  lastStatus: string | null;
  lastMessage: string | null;
  runCount: number;
  /** `never` is the one that means a scheduler was never set up. */
  health: 'ok' | 'late' | 'failing' | 'never';
  minutesSince: number | null;
};

export async function jobStatuses(now: Date = new Date()): Promise<JobStatus[]> {
  const rows = await prisma.jobRun.findMany();
  const byName = new Map(rows.map((r) => [r.name, r]));

  return JOBS.map((job) => {
    const row = byName.get(job.name);
    if (!row) {
      return {
        ...job, lastRunAt: null, lastStatus: null, lastMessage: null, runCount: 0,
        health: 'never' as const, minutesSince: null,
      };
    }
    const minutesSince = Math.floor((now.getTime() - row.lastRunAt.getTime()) / 60_000);
    // Two intervals of grace: one missed run is a blip, two is a pattern.
    const late = minutesSince > job.expectedEveryMinutes * 2;
    return {
      ...job,
      lastRunAt: row.lastRunAt,
      lastStatus: row.lastStatus,
      lastMessage: row.lastMessage,
      runCount: row.runCount,
      health: row.lastStatus === 'failed' ? ('failing' as const) : late ? ('late' as const) : ('ok' as const),
      minutesSince,
    };
  });
}
