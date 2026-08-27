import 'server-only';
import nodemailer from 'nodemailer';
import { prisma } from '@/lib/prisma';

/**
 * Transactional email. Uses SMTP when configured; otherwise logs (dev). Sending is
 * ALWAYS non-blocking and best-effort — an order must succeed even if email fails
 * (brief §67). Every send is recorded as a Notification for observability.
 */

export function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT);
}

let transporter: nodemailer.Transporter | null = null;
function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    });
  }
  return transporter;
}

export type SmtpProbe =
  | { state: 'unconfigured' }
  | { state: 'ok' }
  | { state: 'failing'; error: string };

/**
 * Does the mail server actually accept us?
 *
 * `isEmailConfigured()` answers a different and much weaker question — whether
 * two environment variables are set. Everything past that point can still be
 * wrong, and with Gmail it usually is: an ordinary account password instead of
 * an app password, 2-Step Verification not switched on, port 465 without TLS.
 * All of those set the variables and none of them deliver a message.
 *
 * That matters more than it used to. Email is the only channel a sign-in code
 * goes out on, so a dashboard reporting "SMTP is configured" over a rejected
 * login is not a cosmetic inaccuracy — it is the operator being told the shop
 * works while nobody can get into it.
 *
 * `verify()` opens a real connection and authenticates, so it catches all three.
 * The result is cached because the dashboard is a page an operator refreshes,
 * and a handshake per refresh is a good way to get an IP rate-limited by the
 * very server being checked.
 */
let probe: { at: number; result: SmtpProbe } | null = null;
const PROBE_TTL_MS = 5 * 60_000;

export async function probeSmtp(now: number = Date.now()): Promise<SmtpProbe> {
  if (!isEmailConfigured()) return { state: 'unconfigured' };
  if (probe && now - probe.at < PROBE_TTL_MS) return probe.result;

  let result: SmtpProbe;
  try {
    await getTransporter().verify();
    result = { state: 'ok' };
  } catch (e) {
    result = { state: 'failing', error: e instanceof Error ? e.message : 'connection refused' };
  }
  probe = { at: now, result };
  return result;
}

/** Forget the cached handshake — for a test send, which should never be stale. */
export function resetSmtpProbe(): void {
  probe = null;
}

export type EmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  customerId?: string | null;
  templateKey?: string;
};

/** Send an email. Never throws — returns whether it was dispatched. */
export async function sendEmail(input: EmailInput): Promise<boolean> {
  const from = process.env.SMTP_FROM ?? 'Maya Jewellers <noreply@example.com>';
  let sent = false;
  let error: string | null = null;

  try {
    if (isEmailConfigured()) {
      await getTransporter().sendMail({ from, to: input.to, subject: input.subject, html: input.html, text: input.text });
      sent = true;
    } else {
      console.info(`[email:dev] to=${input.to} subject="${input.subject}"`);
      sent = true; // treated as dispatched in dev
    }
  } catch (e) {
    error = e instanceof Error ? e.message : 'send failed';
    console.error('[email] send failed', error);
  }

  // Record for observability (also best-effort).
  try {
    await prisma.notification.create({
      data: {
        customerId: input.customerId ?? null,
        channel: 'EMAIL',
        templateKey: input.templateKey ?? null,
        target: input.to,
        status: sent ? 'SENT' : 'FAILED',
        error,
        sentAt: sent ? new Date() : null,
      },
    });
  } catch {
    /* ignore */
  }
  return sent;
}
