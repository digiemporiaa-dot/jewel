import 'server-only';
import { prisma } from '@/lib/prisma';
import { getStoreSettings } from '@/lib/store';
import { sendEmail } from '@/lib/email';
import {
  TEMPLATES, templateDefinition, sampleValues, wrapEmail,
  type TemplateDefinition, type TemplateKey,
} from '@/lib/templates/registry';
import { renderTemplate, stripTags } from '@/lib/templates/render';

/**
 * Resolving and sending a template.
 *
 * The one invariant: **this never returns nothing to send.** A missing row, an
 * inactive row, a row whose body was saved empty — all of them fall back to the
 * built-in copy from the registry. The operator can change every word of an
 * order confirmation; they cannot accidentally switch one off.
 */

export type ResolvedTemplate = {
  definition: TemplateDefinition;
  subject: string;
  bodyHtml: string;
  bodyText: string | null;
  /** True when the built-in copy is in use rather than a saved row. */
  usingDefault: boolean;
};

/** Load the operator's version of a template, or the built-in copy. */
export async function resolveTemplate(key: TemplateKey): Promise<ResolvedTemplate | null> {
  const definition = templateDefinition(key);
  if (!definition) return null;

  let row: { subject: string | null; body: string; bodyText: string | null; isActive: boolean } | null = null;
  try {
    row = await prisma.messageTemplate.findUnique({
      where: { key },
      select: { subject: true, body: true, bodyText: true, isActive: true },
    });
  } catch (e) {
    // A database hiccup must not stop an order confirmation going out.
    console.error('[templates] lookup failed, using built-in copy', key, e);
  }

  if (!row || !row.isActive || row.body.trim().length === 0) {
    return {
      definition,
      subject: definition.defaultSubject,
      bodyHtml: definition.defaultBodyHtml,
      bodyText: null,
      usingDefault: true,
    };
  }

  return {
    definition,
    // An empty subject is a half-configured row, not a request for a blank
    // subject line, so it falls back on its own.
    subject: row.subject?.trim() ? row.subject : definition.defaultSubject,
    bodyHtml: row.body,
    bodyText: row.bodyText?.trim() ? row.bodyText : null,
    usingDefault: false,
  };
}

/** Store-wide values every template can reference. */
export async function commonValues(): Promise<Record<string, string>> {
  const store = await getStoreSettings();
  return {
    brand: store.brandName,
    store_phone: store.phone ?? '',
    store_email: store.email ?? '',
    site_url: process.env.NEXT_PUBLIC_SITE_URL ?? '',
  };
}

export type RenderedEmail = { subject: string; html: string; text: string };

/** Substitute values into a resolved template. Pure once the row is loaded. */
export function renderResolved(
  template: ResolvedTemplate,
  values: Record<string, string>
): RenderedEmail {
  const vars = template.definition.variables;
  const html = wrapEmail(renderTemplate(template.bodyHtml, values, vars, 'html'));
  const text = template.bodyText
    ? renderTemplate(template.bodyText, values, vars, 'text')
    : stripTags(html);

  return {
    // Tags in a subject line render as literal angle brackets in every mail
    // client, so strip rather than escape.
    subject: stripTags(renderTemplate(template.subject, values, vars, 'text')).trim(),
    html,
    text,
  };
}

/**
 * Render and send one template. Best-effort: never throws, so a caller in an
 * order or booking path cannot be failed by an email problem.
 */
export async function sendTemplate(params: {
  key: TemplateKey;
  to: string;
  values: Record<string, string>;
  customerId?: string | null;
}): Promise<boolean> {
  try {
    const template = await resolveTemplate(params.key);
    if (!template) return false;

    const values = { ...(await commonValues()), ...params.values };
    const email = renderResolved(template, values);

    return await sendEmail({
      to: params.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      customerId: params.customerId ?? null,
      templateKey: params.key,
    });
  } catch (e) {
    console.error('[templates] send failed', params.key, e);
    return false;
  }
}

/** Preview a body the operator is editing, without saving it. */
export async function previewTemplate(params: {
  key: TemplateKey;
  subject: string;
  bodyHtml: string;
}): Promise<RenderedEmail | null> {
  const definition = templateDefinition(params.key);
  if (!definition) return null;

  // Real store values where we have them, registry samples for the rest, so the
  // preview shows the operator's own shop name rather than "Maya Jewellers".
  const values = { ...sampleValues(definition), ...stripEmpty(await commonValues()) };

  return renderResolved(
    { definition, subject: params.subject, bodyHtml: params.bodyHtml, bodyText: null, usingDefault: false },
    values
  );
}

/** Drop blank store fields so a sample value shows through instead of a gap. */
function stripEmpty(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim().length > 0));
}

/** Admin list: every key in the catalogue, with its saved row if there is one. */
export async function listTemplates() {
  const rows = await prisma.messageTemplate.findMany({
    where: { channel: 'EMAIL' },
    select: { key: true, subject: true, body: true, isActive: true, updatedAt: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r]));

  return TEMPLATES.map((definition) => {
    const row = byKey.get(definition.key);
    return {
      definition,
      customised: Boolean(row && row.body.trim().length > 0),
      isActive: row?.isActive ?? true,
      updatedAt: row?.updatedAt ?? null,
    };
  });
}
