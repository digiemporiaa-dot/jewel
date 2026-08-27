'use server';

import { revalidatePath } from 'next/cache';
import { assertPermission } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { templateDefinition, isTemplateKey, sampleValues } from '@/lib/templates/registry';
import { sanitizeTemplateHtml, unknownVariables, wouldStripMarkup } from '@/lib/templates/render';
import { previewTemplate, resolveTemplate, commonValues, renderResolved } from '@/lib/templates';
import { sendEmail, isEmailConfigured, probeSmtp, resetSmtpProbe } from '@/lib/email';

/**
 * Editing email copy.
 *
 * Two things are enforced here rather than in the browser, because the browser
 * is not a security boundary:
 *
 *  - the body is **sanitised on save**, so the database only ever holds markup
 *    that is safe to render;
 *  - placeholders are checked against the template's **fixed whitelist**, so an
 *    operator cannot invent a variable name and have it silently resolve to
 *    nothing — or, worse, expect it to reach customer data it was never granted.
 *
 * There is no field anywhere on this screen that accepts a script, a `<head>`
 * fragment, or arbitrary markup. What an operator writes is content; the code
 * decides what may execute.
 */

export type Result = { ok: boolean; error?: string; warning?: string };

/** Editing customer-facing copy is a settings-level action. */
const PERMISSION = 'settings.manage' as const;

const MAX_SUBJECT = 200;
const MAX_BODY = 50_000;

function revalidate(key: string): void {
  revalidatePath('/admin/marketing/templates');
  revalidatePath(`/admin/marketing/templates/${key}`);
}

export async function saveTemplateAction(fd: FormData): Promise<Result> {
  const staff = await assertPermission(PERMISSION);

  const key = String(fd.get('key') ?? '');
  if (!isTemplateKey(key)) return { ok: false, error: 'Unknown template' };
  const definition = templateDefinition(key);
  if (!definition) return { ok: false, error: 'Unknown template' };

  const subject = String(fd.get('subject') ?? '').trim();
  const rawBody = String(fd.get('body') ?? '');
  const bodyText = String(fd.get('bodyText') ?? '').trim();
  const isActive = fd.get('isActive') === 'on';

  if (subject.length === 0) return { ok: false, error: 'A subject line is required' };
  if (subject.length > MAX_SUBJECT) return { ok: false, error: `Subject must be under ${MAX_SUBJECT} characters` };
  if (rawBody.trim().length === 0) {
    return { ok: false, error: 'The body cannot be empty. To go back to the built-in wording, use “Reset to default”.' };
  }
  if (rawBody.length > MAX_BODY) return { ok: false, error: 'That body is too long' };

  // Rejected, not silently dropped: an operator who typed {{tracking_number}}
  // needs to know it will never resolve, rather than discover a blank gap in a
  // customer's inbox.
  const unknowns = [
    ...unknownVariables(subject, definition.variables),
    ...unknownVariables(rawBody, definition.variables),
    ...unknownVariables(bodyText, definition.variables),
  ];
  if (unknowns.length > 0) {
    const list = [...new Set(unknowns)].map((u) => `{{${u}}}`).join(', ');
    return { ok: false, error: `This template cannot use ${list}. Use the variables listed beside the editor.` };
  }

  const stripped = wouldStripMarkup(rawBody);
  const body = sanitizeTemplateHtml(rawBody);

  const before = await prisma.messageTemplate.findUnique({
    where: { key },
    select: { subject: true, body: true, bodyText: true, isActive: true },
  });

  await prisma.messageTemplate.upsert({
    where: { key },
    create: { key, channel: 'EMAIL', subject, body, bodyText: bodyText || null, isActive, lastEditedBy: staff.id },
    update: { subject, body, bodyText: bodyText || null, isActive, lastEditedBy: staff.id },
  });

  await writeAudit({
    userId: staff.id,
    action: 'EMAIL_TEMPLATE_UPDATE',
    entity: 'MessageTemplate',
    entityId: key,
    before: before ?? undefined,
    after: { subject, body, bodyText: bodyText || null, isActive },
  });

  revalidate(key);
  return {
    ok: true,
    warning: stripped
      ? 'Saved. Some markup was removed — scripts, embeds and event handlers are not allowed in an email template.'
      : undefined,
  };
}

/**
 * Go back to the built-in wording.
 *
 * Deletes the override row rather than rewriting it with the default text, so
 * the template tracks any future improvement to the built-in copy instead of
 * freezing today's version into the database.
 */
export async function resetTemplateAction(fd: FormData): Promise<Result> {
  const staff = await assertPermission(PERMISSION);

  const key = String(fd.get('key') ?? '');
  if (!isTemplateKey(key)) return { ok: false, error: 'Unknown template' };

  const before = await prisma.messageTemplate.findUnique({
    where: { key },
    select: { subject: true, body: true, bodyText: true, isActive: true },
  });
  if (!before) return { ok: true }; // already on the default

  await prisma.messageTemplate.delete({ where: { key } });
  await writeAudit({
    userId: staff.id,
    action: 'EMAIL_TEMPLATE_RESET',
    entity: 'MessageTemplate',
    entityId: key,
    before,
  });

  revalidate(key);
  return { ok: true };
}

export type PreviewResult = { ok: true; subject: string; html: string } | { ok: false; error: string };

/** Render the draft in the editor against sample data, without saving it. */
export async function previewTemplateAction(fd: FormData): Promise<PreviewResult> {
  await assertPermission(PERMISSION);

  const key = String(fd.get('key') ?? '');
  if (!isTemplateKey(key)) return { ok: false, error: 'Unknown template' };

  // The preview renders in the operator's browser, so it goes through exactly
  // the same sanitiser the saved copy would — a preview that shows something
  // the save would strip is a preview that lies.
  const rendered = await previewTemplate({
    key,
    subject: String(fd.get('subject') ?? ''),
    bodyHtml: sanitizeTemplateHtml(String(fd.get('body') ?? '')),
  });
  if (!rendered) return { ok: false, error: 'Could not render that template' };

  return { ok: true, subject: rendered.subject, html: rendered.html };
}

/** Send the saved version of a template to one address, using sample data. */
export async function sendTestAction(fd: FormData): Promise<Result> {
  const staff = await assertPermission(PERMISSION);

  const key = String(fd.get('key') ?? '');
  if (!isTemplateKey(key)) return { ok: false, error: 'Unknown template' };

  const to = String(fd.get('to') ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) return { ok: false, error: 'Enter a valid email address' };

  // Without SMTP, sendEmail logs and reports success — correct for a dev order
  // path, but here it would tell the operator a test arrived when none did.
  if (!isEmailConfigured()) {
    return { ok: false, error: 'No mail server is configured, so nothing can be sent yet. Set SMTP_HOST and SMTP_PORT in the deployment environment.' };
  }

  // A test send is the one moment a stale answer is worth nothing: the operator
  // has just changed something and is asking whether it took.
  resetSmtpProbe();
  const probe = await probeSmtp();
  if (probe.state === 'failing') {
    return {
      ok: false,
      error:
        `The mail server rejected us: ${probe.error}. With Gmail this is nearly always the password — ` +
        'it has to be a 16-character App Password, and 2-Step Verification has to be on before one can be made.',
    };
  }

  const template = await resolveTemplate(key);
  if (!template) return { ok: false, error: 'Unknown template' };

  // Real store values where they exist, samples for the rest — a test with a
  // blank shop name tells the operator nothing about their own copy.
  const store = Object.fromEntries(
    Object.entries(await commonValues()).filter(([, v]) => v.trim().length > 0)
  );
  const values = { ...sampleValues(template.definition), ...store };
  const email = renderResolved(template, values);

  const sent = await sendEmail({
    to,
    subject: `[Test] ${email.subject}`,
    html: email.html,
    text: email.text,
    templateKey: key,
  });

  await writeAudit({
    userId: staff.id,
    action: 'EMAIL_TEMPLATE_TEST_SEND',
    entity: 'MessageTemplate',
    entityId: key,
    after: { to, sent },
  });

  if (!sent) {
    return { ok: false, error: 'Could not send. Check the SMTP settings in the deployment environment.' };
  }
  return { ok: true };
}
