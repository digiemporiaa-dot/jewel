import 'server-only';
import { prisma } from '@/lib/prisma';
import { isEmailConfigured } from '@/lib/email';
import { isStorageConfigured } from '@/lib/storage';
import { jobStatuses, type JobStatus } from '@/lib/system/jobs';

/**
 * What is quietly not working.
 *
 * Every check here covers something that fails **silently**. A shop with no SMTP
 * does not show an error; it just never sends an order confirmation. A shop with
 * no scheduler does not show an error; it keeps selling at last week's gold rate.
 * Those are the two most expensive states this application can be in, and until
 * now nothing anywhere said a word about either.
 *
 * Read on the dashboard, so the first screen an operator opens is the one that
 * tells them.
 */

export type CheckSeverity = 'critical' | 'warning' | 'ok';

export type HealthCheck = {
  id: string;
  label: string;
  severity: CheckSeverity;
  detail: string;
  /** What to actually do. A warning with no remedy is just noise. */
  fix?: string;
};

/** Rates older than this are being quoted to shoppers as though they were today's. */
const RATE_STALE_HOURS = 48;

export async function systemHealth(now: Date = new Date()): Promise<{
  checks: HealthCheck[];
  jobs: JobStatus[];
  criticalCount: number;
}> {
  const [jobs, rate, tags] = await Promise.all([
    jobStatuses(now),
    prisma.metalRate.findFirst({ where: { isCurrent: true }, orderBy: { effectiveFrom: 'desc' }, select: { effectiveFrom: true } }),
    prisma.marketingTags.findUnique({ where: { id: 'default' }, select: { id: true } }).catch(() => null),
  ]);

  const checks: HealthCheck[] = [];

  // ── Email ──────────────────────────────────────────────────────────────────
  checks.push(
    isEmailConfigured()
      ? { id: 'email', label: 'Email', severity: 'ok', detail: 'SMTP is configured.' }
      : {
          id: 'email',
          label: 'Email',
          severity: 'critical',
          detail: 'No SMTP is configured, so nothing is being sent — including order confirmations. Templates can still be written and previewed.',
          fix: 'Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and SMTP_FROM, then restart.',
        }
  );

  // ── Scheduler ──────────────────────────────────────────────────────────────
  const neverRun = jobs.filter((j) => j.health === 'never');
  const failing = jobs.filter((j) => j.health === 'failing');
  const late = jobs.filter((j) => j.health === 'late');

  if (neverRun.length === jobs.length) {
    checks.push({
      id: 'scheduler',
      label: 'Scheduler',
      severity: 'critical',
      detail: 'None of the scheduled jobs has ever run, which means nothing is calling them. Prices are not being recomputed and no automated email is being sent.',
      fix: 'Point a scheduler at each /api/cron/* endpoint with an Authorization: Bearer $CRON_SECRET header. See docs/DEPLOYMENT.md.',
    });
  } else if (neverRun.length > 0) {
    checks.push({
      id: 'scheduler',
      label: 'Scheduler',
      severity: 'warning',
      detail: `${neverRun.map((j) => j.label).join(', ')} ${neverRun.length === 1 ? 'has' : 'have'} never run.`,
      fix: 'Add the missing endpoints to the scheduler.',
    });
  }

  if (failing.length > 0) {
    checks.push({
      id: 'jobs-failing',
      label: 'Failing jobs',
      severity: 'critical',
      detail: `${failing.map((j) => `${j.label} (${j.lastMessage ?? 'no message'})`).join('; ')}.`,
      fix: 'Check the container logs for the failing job.',
    });
  }

  if (late.length > 0) {
    checks.push({
      id: 'jobs-late',
      label: 'Overdue jobs',
      severity: 'warning',
      detail: `${late.map((j) => `${j.label} last ran ${formatAge(j.minutesSince)} ago`).join('; ')}.`,
      fix: 'The scheduler may have stopped. Confirm it is still running.',
    });
  }

  // ── Metal rates ────────────────────────────────────────────────────────────
  if (!rate) {
    checks.push({
      id: 'rates',
      label: 'Metal rates',
      severity: 'critical',
      detail: 'No live metal rate exists, so weight-based products cannot be priced.',
      fix: 'Enter today’s rates under Metal Rates.',
    });
  } else {
    const hours = (now.getTime() - rate.effectiveFrom.getTime()) / 3_600_000;
    if (hours > RATE_STALE_HOURS) {
      checks.push({
        id: 'rates',
        label: 'Metal rates',
        severity: 'critical',
        detail: `The live rate was set ${Math.floor(hours / 24)} days ago. Every price on the site is derived from it, and shoppers are being quoted it as today’s.`,
        fix: 'Update the rates, and check that the scheduler is calling recompute-prices.',
      });
    } else {
      checks.push({ id: 'rates', label: 'Metal rates', severity: 'ok', detail: `Live rate set ${formatAge(Math.floor(hours * 60))} ago.` });
    }
  }

  // ── Storage ────────────────────────────────────────────────────────────────
  if (!isStorageConfigured()) {
    checks.push({
      id: 'storage',
      label: 'Image uploads',
      severity: 'warning',
      detail: 'No object storage is configured, so images can only be added by pasting a hosted address.',
      fix: 'Set the R2_* variables to enable uploads.',
    });
  }

  // ── Payments ───────────────────────────────────────────────────────────────
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    checks.push({
      id: 'payments',
      label: 'Payments',
      severity: 'critical',
      detail: 'Razorpay is not configured, so online payment cannot be taken.',
      fix: 'Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.',
    });
  }
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    checks.push({
      id: 'payment-webhook',
      label: 'Payment webhook',
      severity: 'critical',
      detail: 'No webhook secret is set, so payment confirmations from Razorpay are rejected. An order paid for while the browser was closed will never be marked paid.',
      fix: 'Set RAZORPAY_WEBHOOK_SECRET to the value configured in the Razorpay dashboard.',
    });
  }

  // ── OTP ────────────────────────────────────────────────────────────────────
  const smsProvider = process.env.SMS_PROVIDER ?? 'console';
  if (smsProvider === 'console') {
    checks.push({
      id: 'otp',
      label: 'Customer sign-in',
      severity: 'critical',
      detail: 'OTP codes are being written to the server log instead of sent, so no customer can sign in or check out as a returning customer.',
      fix: 'Set SMS_PROVIDER=msg91 with MSG91_AUTH_KEY and MSG91_TEMPLATE_ID.',
    });
  }
  if ((process.env.OTP_DEBUG_PHONES ?? '').trim() !== '') {
    checks.push({
      id: 'otp-debug',
      label: 'OTP debug numbers',
      severity: 'warning',
      detail: 'Some numbers have their OTP written to the log rather than sent. Anyone with log access can sign in as them.',
      fix: 'Clear OTP_DEBUG_PHONES before launch.',
    });
  }

  // Marketing tags are optional; noted only so the panel is a full picture.
  if (!tags) {
    checks.push({
      id: 'tags',
      label: 'Analytics',
      severity: 'warning',
      detail: 'No marketing tags are configured, so no traffic or conversion is being measured.',
      fix: 'Add them under Marketing → Tags, or ignore this if measurement is deliberate.',
    });
  }

  return {
    checks,
    jobs,
    criticalCount: checks.filter((c) => c.severity === 'critical').length,
  };
}

export function formatAge(minutes: number | null): string {
  if (minutes === null) return 'never';
  if (minutes < 60) return `${Math.max(0, minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hr`;
  return `${Math.floor(hours / 24)} days`;
}
