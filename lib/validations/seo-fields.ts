import { z } from 'zod';
import { checkImageUrl } from '@/lib/uploads/constraints';

/**
 * The per-entity SEO fields, defined once.
 *
 * Product, Category, Collection, CmsPage and BlogPost all carry the same five
 * columns, and until now three of them — `ogImageUrl`, `canonicalUrl` and
 * `noIndex` — had no form behind them anywhere. Five copies of the same schema
 * would drift, and drift here means one entity silently accepting a value the
 * others reject.
 */

export const seoFieldsSchema = {
  seoTitle: z.string().trim().max(200).optional().nullable(),
  seoDescription: z.string().trim().max(400).optional().nullable(),
  ogImageUrl: z
    .string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .superRefine((value, ctx) => {
      const verdict = checkImageUrl(value ?? '');
      if (!verdict.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: verdict.error });
    }),
  /**
   * A canonical override. Site-relative or absolute, never a scheme that can
   * execute — this ends up in a `<link rel="canonical">` href.
   */
  canonicalUrl: z
    .string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .superRefine((value, ctx) => {
      const url = (value ?? '').trim();
      if (url === '') return;
      if (url.startsWith('/') && !url.startsWith('//')) return;
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Canonical must be an https:// address or a path beginning with /.' });
        }
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Canonical must be an https:// address or a path beginning with /.' });
      }
    }),
  noIndex: z.boolean().optional(),
};

/** Pull the SEO fields out of a submitted form, in the shape the schema wants. */
export function seoFieldsFromForm(fd: FormData) {
  const str = (key: string) => {
    const value = fd.get(key);
    const text = typeof value === 'string' ? value.trim() : '';
    return text === '' ? null : text;
  };
  return {
    seoTitle: str('seoTitle'),
    seoDescription: str('seoDescription'),
    ogImageUrl: str('ogImageUrl'),
    canonicalUrl: str('canonicalUrl'),
    noIndex: fd.get('noIndex') === 'on' || fd.get('noIndex') === 'true',
  };
}

/** The same five values, ready to write. */
export function seoFieldsToData(d: {
  seoTitle?: string | null;
  seoDescription?: string | null;
  ogImageUrl?: string | null;
  canonicalUrl?: string | null;
  noIndex?: boolean;
}) {
  return {
    seoTitle: d.seoTitle ?? null,
    seoDescription: d.seoDescription ?? null,
    ogImageUrl: d.ogImageUrl ?? null,
    canonicalUrl: d.canonicalUrl ?? null,
    noIndex: d.noIndex === true,
  };
}
