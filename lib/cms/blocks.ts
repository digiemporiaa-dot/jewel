import { z } from 'zod';
import type { CmsBlockType } from '@prisma/client';
import { parseVideo, toStored } from '@/lib/video/parse';
import { checkImageUrl } from '@/lib/uploads/constraints';

/**
 * An image address, not markup and not a scheme that can execute. Blocks are
 * rendered into `src` attributes, so the same check the uploader uses runs on
 * save — a value typed straight into the field gets no easier ride than one
 * that arrived through an upload.
 */
function imageAddress() {
  return z
    .string()
    .trim()
    .max(500)
    .superRefine((value, ctx) => {
      const verdict = checkImageUrl(value);
      if (!verdict.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: verdict.error });
    })
    .optional()
    .default('');
}

/** Canonical stored form. Unreachable for invalid input — superRefine ran first. */
function canonicalVideo(value: string): string {
  const parsed = parseVideo(value);
  return parsed.ok ? toStored(parsed.video) : '';
}

/**
 * Fixed CMS block definitions (brief §42). Each block type has a strict schema —
 * there is deliberately NO free-form HTML editor, so content can never inject
 * markup or scripts. Admin edits typed fields; the renderer maps them to
 * brand-consistent components.
 */

export const heroSchema = z.object({
  eyebrow: z.string().trim().max(60).optional().default(''),
  heading: z.string().trim().min(1, 'Heading is required').max(120),
  subheading: z.string().trim().max(300).optional().default(''),
  imageUrl: imageAddress(),
  mobileImageUrl: imageAddress(),
  /** Describes the picture. Falls back to the heading when left blank. */
  imageAlt: z.string().trim().max(160).optional().default(''),
  ctaLabel: z.string().trim().max(40).optional().default(''),
  ctaHref: z.string().trim().max(200).optional().default(''),
});

export const richTextSchema = z.object({
  heading: z.string().trim().max(120).optional().default(''),
  // Plain text only — rendered as paragraphs, never as HTML.
  body: z.string().trim().min(1, 'Body is required').max(5000),
  align: z.enum(['left', 'center']).default('left'),
});

export const imageTextSchema = z.object({
  heading: z.string().trim().max(120).optional().default(''),
  body: z.string().trim().max(2000).optional().default(''),
  imageUrl: imageAddress(),
  imageAlt: z.string().trim().max(160).optional().default(''),
  imagePosition: z.enum(['left', 'right']).default('left'),
  ctaLabel: z.string().trim().max(40).optional().default(''),
  ctaHref: z.string().trim().max(200).optional().default(''),
});

/**
 * A single video.
 *
 * `videoUrl` holds a web address or an ID, never markup. It is validated by
 * `parseVideo` on save and the iframe is built in code — the same rule as the
 * marketing tags, and for the same reason: a CMS field that accepts an embed
 * snippet is a field that accepts a script.
 */
export const videoSchema = z.object({
  heading: z.string().trim().max(120).optional().default(''),
  caption: z.string().trim().max(300).optional().default(''),
  videoUrl: z
    .string()
    .trim()
    .max(500)
    // Empty is allowed so a block can be added and filled in afterwards; the
    // renderer shows nothing until there is a valid video. Anything non-empty
    // must pass the parser, which is what refuses embed code.
    .superRefine((value, ctx) => {
      if (value === '') return;
      const res = parseVideo(value);
      if (!res.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: res.error });
    })
    // Stored canonically as `provider:id`, so the renderer never re-parses a URL
    // and nothing but a validated id reaches the page.
    .transform((value) => (value === '' ? '' : canonicalVideo(value)))
    .default(''),
  /** Optional still. Vimeo does not serve one at a predictable address. */
  posterUrl: imageAddress(),
});

export const productGridSchema = z.object({
  heading: z.string().trim().max(120).optional().default(''),
  source: z.enum(['featured', 'new', 'bestsellers']).default('featured'),
  limit: z.coerce.number().int().min(2).max(12).default(4),
});

export const collectionGridSchema = z.object({
  heading: z.string().trim().max(120).optional().default(''),
  limit: z.coerce.number().int().min(1).max(12).default(3),
});

export const bannerSchema = z.object({
  text: z.string().trim().min(1, 'Text is required').max(200),
  ctaLabel: z.string().trim().max(40).optional().default(''),
  ctaHref: z.string().trim().max(200).optional().default(''),
  tone: z.enum(['velvet', 'paper']).default('velvet'),
});

export const faqSchema = z.object({
  heading: z.string().trim().max(120).optional().default(''),
  items: z.array(z.object({
    question: z.string().trim().min(1).max(200),
    answer: z.string().trim().min(1).max(1000),
  })).min(1, 'Add at least one question'),
});

export const trustRowSchema = z.object({
  items: z.array(z.object({
    title: z.string().trim().min(1).max(60),
    subtitle: z.string().trim().max(120).optional().default(''),
  })).min(1).max(6),
});

export const testimonialsSchema = z.object({
  heading: z.string().trim().max(120).optional().default(''),
  items: z.array(z.object({
    quote: z.string().trim().min(1).max(500),
    author: z.string().trim().max(60).optional().default(''),
  })).min(1).max(6),
});

export const ctaSchema = z.object({
  heading: z.string().trim().min(1, 'Heading is required').max(120),
  subheading: z.string().trim().max(300).optional().default(''),
  ctaLabel: z.string().trim().min(1, 'Button label is required').max(40),
  ctaHref: z.string().trim().min(1, 'Button link is required').max(200),
});

export const BLOCK_SCHEMAS = {
  HERO: heroSchema,
  VIDEO: videoSchema,
  RICH_TEXT: richTextSchema,
  IMAGE_TEXT: imageTextSchema,
  PRODUCT_GRID: productGridSchema,
  COLLECTION_GRID: collectionGridSchema,
  BANNER: bannerSchema,
  FAQ: faqSchema,
  TRUST_ROW: trustRowSchema,
  TESTIMONIALS: testimonialsSchema,
  CTA: ctaSchema,
} as const satisfies Record<CmsBlockType, z.ZodTypeAny>;

export const BLOCK_LABELS: Record<CmsBlockType, string> = {
  HERO: 'Hero',
  VIDEO: 'Video',
  RICH_TEXT: 'Rich text',
  IMAGE_TEXT: 'Image + text',
  PRODUCT_GRID: 'Product grid',
  COLLECTION_GRID: 'Collection grid',
  BANNER: 'Banner',
  FAQ: 'FAQ',
  TRUST_ROW: 'Trust row',
  TESTIMONIALS: 'Testimonials',
  CTA: 'Call to action',
};

/** Validate a block's data against its type's schema. */
export function parseBlockData(type: CmsBlockType, data: unknown) {
  const schema = BLOCK_SCHEMAS[type] as z.ZodTypeAny;
  return schema.safeParse(data);
}

/** Sensible starting content when an admin adds a new block. */
export function defaultBlockData(type: CmsBlockType): Record<string, unknown> {
  switch (type) {
    case 'HERO': return { eyebrow: '', heading: 'A new heading', subheading: '', imageUrl: '', mobileImageUrl: '', imageAlt: '', ctaLabel: '', ctaHref: '' };
    case 'VIDEO': return { heading: '', caption: '', videoUrl: '', posterUrl: '' };
    case 'RICH_TEXT': return { heading: '', body: 'Write something here.', align: 'left' };
    case 'IMAGE_TEXT': return { heading: '', body: '', imageUrl: '', imageAlt: '', imagePosition: 'left', ctaLabel: '', ctaHref: '' };
    case 'PRODUCT_GRID': return { heading: 'Featured', source: 'featured', limit: 4 };
    case 'COLLECTION_GRID': return { heading: 'Collections', limit: 3 };
    case 'BANNER': return { text: 'Announcement', ctaLabel: '', ctaHref: '', tone: 'velvet' };
    case 'FAQ': return { heading: 'Frequently asked', items: [{ question: 'A question?', answer: 'An answer.' }] };
    case 'TRUST_ROW': return { items: [{ title: 'BIS Hallmarked', subtitle: 'Certified purity' }] };
    case 'TESTIMONIALS': return { heading: 'What our customers say', items: [{ quote: 'Beautiful craftsmanship.', author: 'A customer' }] };
    case 'CTA': return { heading: 'Visit our showroom', subheading: '', ctaLabel: 'Book an appointment', ctaHref: '/appointments' };
    default: return {};
  }
}
