import { z } from 'zod';
import type { CmsBlockType } from '@prisma/client';

/**
 * Presentation controls for CMS blocks.
 *
 * Stored inside the existing `CmsBlock.data` JSON under a `style` key, so no
 * migration is needed and blocks saved before this feature existed keep working.
 *
 * Three rules hold this together, and all three matter for a template that gets
 * resold to other jewellers:
 *
 *  1. **Constrained choices only.** No colour picker, no CSS field, no free
 *     spacing input. Every option is a fixed token that maps to a fixed Tailwind
 *     class. Staff without design training cannot produce an off-brand page, and
 *     a coherent look survives every redeployment.
 *  2. **Never interpolate a stored value into a class string.** Tailwind's
 *     scanner cannot see `bg-${x}`, so such a class would be missing from the
 *     production stylesheet — and it is an injection surface besides. Every class
 *     below is a complete literal.
 *  3. **Absent style === today's appearance.** Each type's defaults reproduce the
 *     markup as it shipped, seeded from the legacy content fields where one
 *     already existed (`RICH_TEXT.align`, `IMAGE_TEXT.imagePosition`,
 *     `BANNER.tone`), so published pages do not shift on deploy.
 */

// ─── Vocabulary ──────────────────────────────────────────────────────────────

export const BACKGROUNDS = ['none', 'paper-2', 'velvet', 'brass-tint'] as const;
export const SPACINGS = ['compact', 'normal', 'roomy'] as const;
export const ALIGNMENTS = ['left', 'center'] as const;
export const WIDTHS = ['contained', 'full'] as const;
export const MEDIA_SIDES = ['left', 'right'] as const;
export const COLUMN_COUNTS = [2, 3, 4] as const;

export type Background = (typeof BACKGROUNDS)[number];
export type Spacing = (typeof SPACINGS)[number];
export type Alignment = (typeof ALIGNMENTS)[number];
export type Width = (typeof WIDTHS)[number];
export type MediaSide = (typeof MEDIA_SIDES)[number];
export type ColumnCount = (typeof COLUMN_COUNTS)[number];

export type BlockStyle = {
  background: Background;
  spacing: Spacing;
  align: Alignment;
  width: Width;
  mediaSide: MediaSide;
  columns: ColumnCount;
};

/** Which controls a block type actually offers. `mediaSide` on a FAQ is noise. */
export type StyleControl = keyof BlockStyle;

/**
 * Stored shape: every key optional, because old blocks have no `style` at all and
 * a partially-filled one must still load. `catch` makes an unrecognised value
 * fall back to undefined (→ the type default) instead of throwing, so a block
 * saved by a future version of the editor still renders here.
 */
const storedStyleSchema = z.object({
  background: z.enum(BACKGROUNDS).optional().catch(undefined),
  spacing: z.enum(SPACINGS).optional().catch(undefined),
  align: z.enum(ALIGNMENTS).optional().catch(undefined),
  width: z.enum(WIDTHS).optional().catch(undefined),
  mediaSide: z.enum(MEDIA_SIDES).optional().catch(undefined),
  columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional().catch(undefined),
});

export type StoredBlockStyle = z.infer<typeof storedStyleSchema>;

// ─── Per-type capability map ─────────────────────────────────────────────────

type Capability = {
  /** Controls surfaced in the editor, in display order. */
  controls: readonly StyleControl[];
  /** Values that reproduce the block's original hard-coded appearance. */
  defaults: BlockStyle;
};

const BASE_DEFAULTS: BlockStyle = {
  background: 'none',
  spacing: 'normal',
  align: 'left',
  width: 'contained',
  mediaSide: 'left',
  columns: 3,
};

function caps(controls: readonly StyleControl[], overrides: Partial<BlockStyle> = {}): Capability {
  return { controls, defaults: { ...BASE_DEFAULTS, ...overrides } };
}

/**
 * Adding a block type later is a one-place change: add its row here and the
 * editor, the validator and the renderer all pick it up.
 *
 * Two deliberate omissions:
 *  - `PRODUCT_GRID` has no `columns`. It renders as a scroll-snap carousel on
 *    mobile and a fixed grid on desktop; its `limit` field already governs count.
 *  - `IMAGE_TEXT` has no `align`, because its two-column layout has no single
 *    text axis to align.
 */
export const BLOCK_STYLE_CAPABILITIES = {
  HERO: caps(['background', 'spacing', 'align', 'width'], { background: 'paper-2' }),
  RICH_TEXT: caps(['background', 'spacing', 'align', 'width']),
  // No `align`: the player fills its container, so there is no text axis to
  // align — only the heading and caption, which follow the block's own width.
  VIDEO: caps(['background', 'spacing', 'width']),
  IMAGE_TEXT: caps(['background', 'spacing', 'width', 'mediaSide']),
  PRODUCT_GRID: caps(['background', 'spacing', 'width']),
  COLLECTION_GRID: caps(['background', 'spacing', 'align', 'width', 'columns']),
  BANNER: caps(['background', 'spacing', 'width'], { background: 'velvet', align: 'center' }),
  FAQ: caps(['background', 'spacing', 'align', 'width'], { align: 'center' }),
  TRUST_ROW: caps(['background', 'spacing', 'align', 'width', 'columns'], { align: 'center', columns: 4 }),
  TESTIMONIALS: caps(['background', 'spacing', 'align', 'width', 'columns'], { align: 'center' }),
  CTA: caps(['background', 'spacing', 'align', 'width'], { background: 'velvet', align: 'center' }),
} as const satisfies Record<CmsBlockType, Capability>;

export function styleControlsFor(type: CmsBlockType): readonly StyleControl[] {
  return BLOCK_STYLE_CAPABILITIES[type].controls;
}

export function supportsControl(type: CmsBlockType, control: StyleControl): boolean {
  return BLOCK_STYLE_CAPABILITIES[type].controls.includes(control);
}

// ─── Legacy content fields ───────────────────────────────────────────────────

/**
 * Three block types shipped with a presentation field inside their *content*
 * schema. Rather than leave two controls fighting over one visual outcome, the
 * style value seeds itself from the legacy field, and `syncLegacyFields` writes
 * it back on save so both stay in step. Existing rows therefore render exactly as
 * before, and the editor shows a single control.
 */
function seedFromLegacy(type: CmsBlockType, content: Record<string, unknown>): Partial<BlockStyle> {
  switch (type) {
    case 'RICH_TEXT': {
      const align = content.align;
      return align === 'center' || align === 'left' ? { align } : {};
    }
    case 'IMAGE_TEXT': {
      const side = content.imagePosition;
      return side === 'left' || side === 'right' ? { mediaSide: side } : {};
    }
    case 'BANNER': {
      // `tone: 'paper'` historically rendered as bg-paper-2.
      if (content.tone === 'paper') return { background: 'paper-2' };
      if (content.tone === 'velvet') return { background: 'velvet' };
      return {};
    }
    default:
      return {};
  }
}

/**
 * Mirror the style back onto the legacy content fields so the block's own schema
 * stays valid and nothing reads a stale value. Returns a new object; callers pass
 * the already-validated content.
 */
export function syncLegacyFields(
  type: CmsBlockType,
  content: Record<string, unknown>,
  style: BlockStyle
): Record<string, unknown> {
  switch (type) {
    case 'RICH_TEXT':
      return { ...content, align: style.align };
    case 'IMAGE_TEXT':
      return { ...content, imagePosition: style.mediaSide };
    case 'BANNER':
      return { ...content, tone: style.background === 'velvet' ? 'velvet' : 'paper' };
    default:
      return content;
  }
}

// ─── Reading and validating ──────────────────────────────────────────────────

/**
 * Validate a submitted style, keeping only the controls this type offers. Unknown
 * or malformed values are dropped rather than throwing — a bad style should never
 * cost an editor their content edit.
 */
export function parseBlockStyle(type: CmsBlockType, raw: unknown): StoredBlockStyle {
  const parsed = storedStyleSchema.safeParse(raw ?? {});
  if (!parsed.success) return {};

  const allowed = BLOCK_STYLE_CAPABILITIES[type].controls;
  const out: StoredBlockStyle = {};
  for (const control of allowed) {
    const value = parsed.data[control];
    if (value === undefined) continue;
    // Narrow per key: the union of value types is not assignable wholesale.
    switch (control) {
      case 'background': out.background = value as Background; break;
      case 'spacing': out.spacing = value as Spacing; break;
      case 'align': out.align = value as Alignment; break;
      case 'width': out.width = value as Width; break;
      case 'mediaSide': out.mediaSide = value as MediaSide; break;
      case 'columns': out.columns = value as ColumnCount; break;
    }
  }
  return out;
}

/**
 * Resolve the effective style for a block: stored style wins, then the legacy
 * content field, then the type's default. Always returns a complete style, so
 * callers never branch on undefined.
 */
export function resolveBlockStyle(type: CmsBlockType, data: unknown): BlockStyle {
  const content = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const stored = parseBlockStyle(type, content.style);
  return {
    ...BLOCK_STYLE_CAPABILITIES[type].defaults,
    ...seedFromLegacy(type, content),
    ...stored,
  };
}

// ─── Class maps — every entry a complete literal ─────────────────────────────

const BACKGROUND_CLASS: Record<Background, string> = {
  none: '',
  'paper-2': 'bg-paper-2',
  velvet: 'bg-velvet',
  'brass-tint': 'bg-brass/10',
};

/**
 * Headings carry an explicit `color: var(--ink)` from globals.css, so a dark
 * background needs the light colour applied deliberately — inheriting is not
 * enough. Dark text on velvet is the obvious failure mode and staff would not
 * catch it in the editor, where the block is shown on white.
 */
type Tone = 'dark' | 'light';

const TONE_CLASSES: Record<Tone, { text: string; heading: string; muted: string; border: string; divide: string }> = {
  dark: { text: '', heading: '', muted: 'text-ink-soft', border: 'border-line', divide: 'divide-line' },
  light: { text: 'text-paper', heading: 'text-paper', muted: 'text-paper/70', border: 'border-paper/25', divide: 'divide-paper/25' },
};

function toneFor(background: Background): Tone {
  return background === 'velvet' ? 'light' : 'dark';
}

/** Most blocks shipped with `py-12`; HERO and BANNER had their own rhythm. */
const SPACING_CLASS: Record<Spacing, string> = {
  compact: 'py-6',
  normal: 'py-12',
  roomy: 'py-20 lg:py-24',
};

const SPACING_OVERRIDES: Partial<Record<CmsBlockType, Record<Spacing, string>>> = {
  HERO: { compact: 'py-10', normal: 'py-14 lg:py-20', roomy: 'py-24 lg:py-32' },
  BANNER: { compact: 'py-3', normal: 'py-6', roomy: 'py-10' },
  TRUST_ROW: { compact: 'py-6', normal: 'py-10', roomy: 'py-16' },
  CTA: { compact: 'py-8', normal: 'py-14', roomy: 'py-20 lg:py-24' },
};

const WIDTH_CLASS: Record<Width, string> = {
  contained: 'shell',
  full: 'w-full px-4 sm:px-6 lg:px-10',
};

const ALIGN_CLASS: Record<Alignment, string> = {
  left: 'text-left',
  center: 'text-center',
};

const COLUMNS_CLASS: Record<ColumnCount, string> = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-2 lg:grid-cols-4',
};

/** Resolved class names for a block. All fixed strings — safe for Tailwind. */
export type BlockStyleClasses = {
  /** Outer <section>: background + text colour. */
  section: string;
  /** Inner wrapper: width + vertical rhythm. */
  inner: string;
  /** Text alignment, when the type offers it. */
  align: string;
  /** Heading colour override for dark backgrounds ('' on light). */
  heading: string;
  /** Secondary/body text colour. */
  muted: string;
  /** Border colour that stays visible on the chosen background. */
  border: string;
  /** Divider colour for stacked lists (FAQ). */
  divide: string;
  /** Grid template, for the types that offer `columns`. */
  columns: string;
  /** True when the background is dark and content must render light. */
  isDark: boolean;
};

export function blockStyleClasses(type: CmsBlockType, style: BlockStyle): BlockStyleClasses {
  const tone = toneFor(style.background);
  const t = TONE_CLASSES[tone];
  const spacing = (SPACING_OVERRIDES[type] ?? SPACING_CLASS)[style.spacing];

  return {
    section: [BACKGROUND_CLASS[style.background], t.text].filter(Boolean).join(' '),
    inner: [WIDTH_CLASS[style.width], spacing].join(' '),
    align: ALIGN_CLASS[style.align],
    heading: t.heading,
    muted: t.muted,
    border: t.border,
    divide: t.divide,
    columns: COLUMNS_CLASS[style.columns],
    isDark: tone === 'light',
  };
}

/** Convenience: resolve and map in one call. */
export function styleFor(type: CmsBlockType, data: unknown): BlockStyleClasses & { style: BlockStyle } {
  const style = resolveBlockStyle(type, data);
  return { ...blockStyleClasses(type, style), style };
}

// ─── Editor labels ───────────────────────────────────────────────────────────

export const STYLE_CONTROL_LABELS: Record<StyleControl, string> = {
  background: 'Background',
  spacing: 'Spacing',
  align: 'Text alignment',
  width: 'Width',
  mediaSide: 'Image side',
  columns: 'Columns',
};

export const STYLE_OPTION_LABELS: Record<string, string> = {
  none: 'None',
  'paper-2': 'Soft paper',
  velvet: 'Velvet (dark)',
  'brass-tint': 'Brass tint',
  compact: 'Compact',
  normal: 'Normal',
  roomy: 'Roomy',
  left: 'Left',
  center: 'Centre',
  right: 'Right',
  contained: 'Contained',
  full: 'Full width',
  '2': '2',
  '3': '3',
  '4': '4',
};

/** Option values for one control, for rendering a <select>. */
export function styleOptions(control: StyleControl): readonly (string | number)[] {
  switch (control) {
    case 'background': return BACKGROUNDS;
    case 'spacing': return SPACINGS;
    case 'align': return ALIGNMENTS;
    case 'width': return WIDTHS;
    case 'mediaSide': return MEDIA_SIDES;
    case 'columns': return COLUMN_COUNTS;
  }
}
