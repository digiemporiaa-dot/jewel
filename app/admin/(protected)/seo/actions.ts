'use server';

import { revalidatePath } from 'next/cache';
import { assertPermission } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { revalidateSeoSettings, siteUrl } from '@/lib/seo/settings';
import { checkCanonical } from '@/lib/seo/url';

/**
 * Saving site-wide SEO settings.
 *
 * Two things are validated rather than trusted, both because getting them wrong
 * is quiet and expensive:
 *
 *  - A **title template without `%s`** would give every page in the site the
 *    same title. The renderer already ignores such a template, but an operator
 *    who typed one deserves to be told, not silently overruled.
 *  - **Robots disallow paths** are written verbatim into robots.txt, so a value
 *    containing a newline could inject a rule nobody intended — including one
 *    disallowing everything.
 */

export type Result = { ok: boolean; error?: string };

const PERMISSION = 'settings.manage' as const;

const MAX_TITLE_TEMPLATE = 100;
const MAX_DESCRIPTION = 320;
const MAX_DISALLOW_ENTRIES = 50;

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? '').trim();
}

/** Split the textarea into paths, rejecting anything that could inject a rule. */
function parseDisallow(raw: string): { ok: true; paths: string[] } | { ok: false; error: string } {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length > MAX_DISALLOW_ENTRIES) {
    return { ok: false, error: `That is more than ${MAX_DISALLOW_ENTRIES} paths. Keep the list to the ones that matter.` };
  }
  for (const line of lines) {
    if (/\s/.test(line)) {
      return { ok: false, error: `"${line}" contains a space. A robots.txt path cannot have one.` };
    }
    if (!line.startsWith('/')) {
      return { ok: false, error: `"${line}" must start with a slash, like /private.` };
    }
  }
  return { ok: true, paths: lines };
}

export async function saveSeoSettingsAction(fd: FormData): Promise<Result> {
  const staff = await assertPermission(PERMISSION);

  const titleTemplate = str(fd, 'titleTemplate');
  if (titleTemplate && !titleTemplate.includes('%s')) {
    return {
      ok: false,
      error: 'The title template must contain %s, which stands for each page’s own title. Without it every page would have the same title.',
    };
  }
  if (titleTemplate.length > MAX_TITLE_TEMPLATE) {
    return { ok: false, error: 'That title template is too long.' };
  }

  const defaultDescription = str(fd, 'defaultDescription');
  if (defaultDescription.length > MAX_DESCRIPTION) {
    return { ok: false, error: `The default description must be under ${MAX_DESCRIPTION} characters.` };
  }

  const disallow = parseDisallow(String(fd.get('robotsDisallow') ?? ''));
  if (!disallow.ok) return { ok: false, error: disallow.error };

  const lat = str(fd, 'latitude');
  const lng = str(fd, 'longitude');
  if ((lat && !lng) || (lng && !lat)) {
    // One coordinate is not a location; publishing half of a geo node is
    // invalid structured data.
    return { ok: false, error: 'Enter both latitude and longitude, or neither.' };
  }
  if (lat && (Number.isNaN(Number(lat)) || Math.abs(Number(lat)) > 90)) {
    return { ok: false, error: 'Latitude must be a number between -90 and 90.' };
  }
  if (lng && (Number.isNaN(Number(lng)) || Math.abs(Number(lng)) > 180)) {
    return { ok: false, error: 'Longitude must be a number between -180 and 180.' };
  }

  const data = {
    titleTemplate: titleTemplate || null,
    defaultTitle: str(fd, 'defaultTitle') || null,
    defaultDescription: defaultDescription || null,
    defaultOgImageUrl: str(fd, 'defaultOgImageUrl') || null,
    indexingEnabled: fd.get('indexingEnabled') === 'on',
    robotsDisallow: disallow.paths,
    localBusinessEnabled: fd.get('localBusinessEnabled') === 'on',
    businessType: str(fd, 'businessType') || null,
    priceRange: str(fd, 'priceRange') || null,
    latitude: lat || null,
    longitude: lng || null,
    bingVerification: str(fd, 'bingVerification') || null,
    pinterestVerification: str(fd, 'pinterestVerification') || null,
  };

  const before = await prisma.seoSettings.findUnique({ where: { id: 'default' } });

  await prisma.seoSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default', ...data },
    update: data,
  });

  await writeAudit({
    userId: staff.id,
    action: 'SEO_SETTINGS_UPDATE',
    entity: 'SeoSettings',
    entityId: 'default',
    before: before
      ? { indexingEnabled: before.indexingEnabled, titleTemplate: before.titleTemplate }
      : undefined,
    after: { indexingEnabled: data.indexingEnabled, titleTemplate: data.titleTemplate },
  });

  revalidateSeoSettings();
  revalidatePath('/admin/seo');
  return { ok: true };
}

/**
 * Check a canonical URL without saving it, so the admin can warn as it is typed
 * rather than only on submit.
 */
export async function checkCanonicalAction(value: string): Promise<Result> {
  await assertPermission(PERMISSION);
  if (!value.trim()) return { ok: true };
  const res = checkCanonical(value, siteUrl());
  return res.ok ? { ok: true } : { ok: false, error: res.reason };
}
