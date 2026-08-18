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
