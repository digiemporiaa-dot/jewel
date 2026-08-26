import { z } from 'zod';

/**
 * The prize table, and how a winner is chosen from it.
 *
 * Pure and free of `server-only`: the draw is the part of this feature that has
 * to be provably fair, so it is written where a test can hammer it a hundred
 * thousand times.
 *
 * Three rules are enforced here rather than left to whoever fills in the admin
 * form, because each of them is a way to lose real money or to mislead a
 * customer:
 *
 *  1. **A percentage is never uncapped.** Jewellery carts run to lakhs. "10% off"
 *     with no ceiling is unbounded downside on a single spin.
 *  2. **Nothing discounts metal.** Gold sells at the live rate with effectively
 *     no markup, so a discount there comes out of stock sold at cost — 10% of a
 *     ₹4,00,000 necklace is ₹40,000, almost none of it margin. Making charges and
 *     stone value are where the margin actually is.
 *  3. **Every segment on the wheel is genuinely winnable.** The CCPA dark-pattern
 *     guidelines do not forbid weighted odds; they forbid misrepresenting them.
 *     A segment drawn on the wheel that cannot come up is a painted-on prize.
 */

/** Where a won discount may be taken from. */
export const ALLOWED_SCOPES = ['MAKING_CHARGES', 'STONE_VALUE'] as const;
export type SpinScope = (typeof ALLOWED_SCOPES)[number];

export const SCOPE_LABELS: Record<SpinScope, string> = {
  MAKING_CHARGES: 'Making charges',
  STONE_VALUE: 'Stone value',
};

/**
 * `ORDER_TOTAL` and `METAL_VALUE` are refused for the same reason, and the
 * message says which one was picked so the operator is not left guessing.
 */
export const SCOPE_REFUSED =
  'A spin prize can only discount making charges or stone value. Metal is sold at the live ' +
  'rate with no margin in it, so a discount on the order total or on metal value is paid out ' +
  'of gold sold at cost.';

const couponPrizeSchema = z.object({
  kind: z.literal('COUPON'),
  type: z.enum(['PERCENTAGE', 'FLAT']),
  appliesTo: z.enum(ALLOWED_SCOPES),
  /** Percent (1–100) for PERCENTAGE, rupees for FLAT. */
  value: z.number().positive().max(100000),
  /** Rupee ceiling. Required for a percentage; meaningless for a flat amount. */
  maxDiscount: z.number().positive().max(1000000).nullable(),
  minOrder: z.number().nonnegative().max(10000000).nullable(),
});

/**
 * A prize that copies its terms from a coupon the shop already created.
 *
 * This is what "put my existing coupons on the wheel" means without breaking the
 * thing that makes a spin prize safe. The referenced coupon is a *template*: its
 * type, value, scope and cap are read at the moment somebody wins, and a fresh
 * single-use code is minted and locked to the winner's number. Handing out the
 * shared code itself would produce one coupon that every winner holds, bound to
 * nobody and forwardable to anyone.
 *
 * The scope is re-checked against `ALLOWED_SCOPES` at win time, so a coupon
 * created for the order total in the Coupons screen cannot reach the wheel by
 * being referenced from here.
 */
const templatePrizeSchema = z.object({
  kind: z.literal('TEMPLATE'),
  couponId: z.string().min(1, 'Choose a coupon'),
  /** Shown on the wheel and in the results list if the coupon is later deleted. */
  couponCode: z.string().trim().min(1).max(40),
});

/** A segment that wins nothing. Its presence is checked below. */
const nothingPrizeSchema = z.object({ kind: z.literal('NONE') });

/**
 * Segment colours.
 *
 * Fixed tokens, not a colour picker. Two reasons, and both are the same reasons
 * the CMS block styles work this way: Tailwind cannot see a class built by string
 * interpolation, so `bg-${x}` would simply be missing from the production
 * stylesheet — and staff without design training cannot produce an off-brand
 * wheel from a closed list.
 */
export const SEGMENT_COLOURS = [
  // The original five, in their original order. Wheels saved before the palette
  // grew keep exactly the colours they had.
  'paper', 'brass', 'velvet', 'blush', 'sage',
  // Added later: deeper and lighter tints of the two brand colours, a wine, a
  // soft gold, a charcoal and a stone.
  //
  // Twelve is not an arbitrary number — it is the segment maximum. One colour
  // per possible segment means the index fallback below is `index % 12` over at
  // most twelve wedges, so it never wraps and no wheel can repeat a colour at
  // all, adjacent or otherwise. Eleven colours produced exactly that collision
  // on a full wheel, and a test caught it.
  'brass-deep', 'brass-light', 'velvet-light', 'wine', 'gold', 'charcoal', 'stone',
] as const;
export type SegmentColour = (typeof SEGMENT_COLOURS)[number];

export const COLOUR_LABELS: Record<SegmentColour, string> = {
  paper: 'Ivory',
  brass: 'Brass',
  velvet: 'Deep green',
  blush: 'Blush',
  sage: 'Sage',
  'brass-deep': 'Antique brass',
  'brass-light': 'Champagne',
  'velvet-light': 'Emerald',
  wine: 'Wine',
  gold: 'Soft gold',
  charcoal: 'Charcoal',
  stone: 'Stone',
};

/**
 * Complete literals — see the note above — each paired with the text colour that
 * reads on it.
 *
 * The pairing is not a matter of taste. A prize label nobody can read is worse
 * than one fewer colour, so every pair here clears **WCAG AA for normal text
 * (4.5:1)** — the wheel labels are small, so the 3:1 large-text allowance does
 * not apply. `tests/spin.test.ts` computes the ratios rather than trusting this
 * comment, so a colour added later cannot slip through unreadable.
 */
export const COLOUR_HEX: Record<SegmentColour, { fill: string; text: string }> = {
  paper: { fill: '#F2EDE4', text: '#161513' },
  brass: { fill: '#A8813C', text: '#161513' },
  velvet: { fill: '#17362C', text: '#FFFFFF' },
  blush: { fill: '#E8D5D0', text: '#161513' },
  sage: { fill: '#C8D0C0', text: '#161513' },
  'brass-deep': { fill: '#7A5C24', text: '#FFFFFF' },
  'brass-light': { fill: '#D9C08A', text: '#161513' },
  'velvet-light': { fill: '#2E5B4A', text: '#FFFFFF' },
  wine: { fill: '#6B2233', text: '#FFFFFF' },
  gold: { fill: '#E4C97E', text: '#161513' },
  charcoal: { fill: '#2B2A28', text: '#FFFFFF' },
  stone: { fill: '#B9AA96', text: '#161513' },
};

export const segmentSchema = z
  .object({
    label: z.string().trim().min(1, 'Every segment needs a label').max(40),
    /**
     * Relative chance. Must be at least 1: a zero-weight segment is drawn on the
     * wheel, shown to the customer, and can never come up.
     */
    weight: z.number().int().min(1, 'Every segment must be winnable — use a weight of at least 1').max(10000),
    /** Absent on wheels saved before colours existed; falls back when rendering. */
    colour: z.enum(SEGMENT_COLOURS).optional().catch(undefined),
    prize: z.discriminatedUnion('kind', [couponPrizeSchema, templatePrizeSchema, nothingPrizeSchema]),
  })
  // Refined here rather than on the prize itself: a `discriminatedUnion` member
  // has to stay a plain object, and wrapping one in `superRefine` makes it a
  // `ZodEffects` the union will not accept.
  .superRefine((segment, ctx) => {
    const { prize } = segment;
    if (prize.kind !== 'COUPON' || prize.type !== 'PERCENTAGE') return;
    if (prize.value > 100) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['prize', 'value'], message: 'A percentage cannot exceed 100' });
    }
    if (prize.maxDiscount === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['prize', 'maxDiscount'],
        message: 'A percentage prize needs a rupee cap — an uncapped percentage on a jewellery cart is unbounded',
      });
    }
  });

export type SpinSegment = z.infer<typeof segmentSchema>;
export type CouponPrize = Extract<SpinSegment['prize'], { kind: 'COUPON' }>;
export type TemplatePrize = Extract<SpinSegment['prize'], { kind: 'TEMPLATE' }>;

/** The colour a segment renders as, for one saved before colours existed. */
export function colourFor(segment: SpinSegment, index: number): SegmentColour {
  // Cycles the whole palette rather than alternating two.
  //
  // The palette is as long as a wheel may be, so for any legal wheel this is
  // `index % 12` over at most twelve wedges and every one gets its own colour.
  // The old version alternated ivory and brass, which made a nine-segment wheel
  // five of one and four of the other.
  return segment.colour ?? (SEGMENT_COLOURS[index % SEGMENT_COLOURS.length] ?? 'paper');
}

export const segmentsSchema = z
  .array(segmentSchema)
  .min(2, 'A wheel needs at least two segments')
  .max(12, 'More than twelve segments is unreadable on a phone')
  .superRefine((segments, ctx) => {
    // A wheel where every outcome wins reads as fake and devalues the prize.
    // It is also the shape most likely to be read as a dark pattern.
    if (!segments.some((s) => s.prize.kind === 'NONE')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Include one segment that wins nothing. A wheel where every outcome wins is not believable.',
      });
    }
    // "Weighted" is fine. "Pre-determined" is not: if one segment holds all the
    // weight the animation is theatre and the outcome was never in doubt.
    const total = segments.reduce((sum, s) => sum + s.weight, 0);
    if (segments.some((s) => s.weight === total)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'One segment holds all of the weight, so every spin lands there. At least two outcomes must be possible.',
      });
    }
  });

export type SegmentParse =
  | { ok: true; segments: SpinSegment[] }
  | { ok: false; error: string };

export function parseSegments(raw: unknown): SegmentParse {
  const parsed = segmentsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid segments' };
  return { ok: true, segments: parsed.data };
}

export function totalWeight(segments: readonly SpinSegment[]): number {
  return segments.reduce((sum, s) => sum + s.weight, 0);
}

/**
 * Pick the winning segment.
 *
 * `roll` is an integer in `[0, totalWeight)`, supplied by the caller so the
 * randomness comes from `crypto.randomInt` in production and from a fixture in
 * tests. Taking an integer rather than a float keeps the distribution exactly
 * proportional to the weights — scaling a float by the total reintroduces the
 * rounding bias this is meant to avoid.
 *
 * Returns null only for an empty list, which `segmentsSchema` already forbids.
 */
export function pickSegment(segments: readonly SpinSegment[], roll: number): SpinSegment | null {
  if (segments.length === 0) return null;
  const total = totalWeight(segments);
  // Clamped rather than trusted. A caller that passes a roll outside the range
  // would otherwise fall through the loop and silently always return the last
  // segment — a rigged wheel produced by an off-by-one.
  const bounded = Math.min(Math.max(Math.floor(roll), 0), total - 1);

  let cursor = 0;
  for (const segment of segments) {
    cursor += segment.weight;
    if (bounded < cursor) return segment;
  }
  return segments[segments.length - 1] ?? null;
}

/** The odds as shown to a customer, so the disclosure and the draw agree. */
export function oddsPercent(segments: readonly SpinSegment[], segment: SpinSegment): number {
  const total = totalWeight(segments);
  if (total === 0) return 0;
  return Math.round((segment.weight / total) * 1000) / 10;
}

/** One line of plain terms per winnable prize, for the T&C the wheel links to. */
export function describePrize(prize: SpinSegment['prize'], validityDays: number): string {
  if (prize.kind === 'NONE') return 'No prize on this segment.';
  // A template's real terms live on the coupon row and are read at win time;
  // `resolveTemplate` in lib/spin/index.ts turns it into the branch below.
  if (prize.kind === 'TEMPLATE') return `Terms taken from coupon ${prize.couponCode}.`;
  const amount = prize.type === 'PERCENTAGE' ? `${prize.value}% off` : `₹${prize.value} off`;
  const scope = SCOPE_LABELS[prize.appliesTo as SpinScope].toLowerCase();
  const cap = prize.maxDiscount !== null ? `, up to ₹${prize.maxDiscount}` : '';
  const min = prize.minOrder ? ` on orders over ₹${prize.minOrder}` : '';
  return `${amount} ${scope}${cap}${min}. One use, valid ${validityDays} days.`;
}

/**
 * A believable default wheel, used to seed a new campaign in the admin so an
 * operator starts from something sane rather than a blank JSON field.
 */
export const DEFAULT_SEGMENTS: SpinSegment[] = [
  { label: '10% off making', weight: 5, prize: { kind: 'COUPON', type: 'PERCENTAGE', appliesTo: 'MAKING_CHARGES', value: 10, maxDiscount: 2000, minOrder: null } },
  { label: '5% off making', weight: 25, prize: { kind: 'COUPON', type: 'PERCENTAGE', appliesTo: 'MAKING_CHARGES', value: 5, maxDiscount: 1000, minOrder: null } },
  { label: '₹500 off making', weight: 20, prize: { kind: 'COUPON', type: 'FLAT', appliesTo: 'MAKING_CHARGES', value: 500, maxDiscount: null, minOrder: 10000 } },
  { label: 'Better luck next time', weight: 30, prize: { kind: 'NONE' } },
  { label: '₹250 off making', weight: 20, prize: { kind: 'COUPON', type: 'FLAT', appliesTo: 'MAKING_CHARGES', value: 250, maxDiscount: null, minOrder: 5000 } },
];

// ─── What the wheel says and how it looks ────────────────────────────────────

/**
 * The wheel's copy and styling, stored alongside its segments.
 *
 * Every field is text or a fixed token — there is no HTML field, no CSS field
 * and no colour picker. The same rule as the CMS blocks and for the same reason:
 * an operator-supplied style string is both an injection surface and a way to
 * produce something that does not look like the shop.
 *
 * Every field is optional and falls back, so a campaign saved before any of this
 * existed keeps rendering exactly as it did.
 */
export const presentationSchema = z.object({
  eyebrow: z.string().trim().max(40).optional().or(z.literal('')),
  heading: z.string().trim().max(80).optional().or(z.literal('')),
  subheading: z.string().trim().max(200).optional().or(z.literal('')),
  phoneLabel: z.string().trim().max(60).optional().or(z.literal('')),
  phoneHint: z.string().trim().max(200).optional().or(z.literal('')),
  buttonLabel: z.string().trim().max(30).optional().or(z.literal('')),
  winHeading: z.string().trim().max(80).optional().or(z.literal('')),
  loseMessage: z.string().trim().max(200).optional().or(z.literal('')),
  footnote: z.string().trim().max(300).optional().or(z.literal('')),
  /**
   * A picture above the wheel. Stored as a URL from the shared uploader, never
   * as markup — see components/admin/ImageUploadField.
   */
  imageUrl: z.string().trim().max(500).optional().or(z.literal('')),
  imageAlt: z.string().trim().max(160).optional().or(z.literal('')),
  /** The dialog's own background, from the same closed list as the segments. */
  background: z.enum(['paper', 'velvet']).optional().catch(undefined),
});

export type SpinPresentation = z.infer<typeof presentationSchema>;

/** What the wheel says when the shop has not said otherwise. */
export const PRESENTATION_DEFAULTS = {
  eyebrow: '',
  heading: 'Spin for a first-order treat',
  subheading: '',
  phoneLabel: 'Mobile number',
  phoneHint: 'One spin per number. Your prize is saved against it and applied when you check out.',
  buttonLabel: 'Spin the wheel',
  winHeading: 'You won',
  loseMessage: 'No prize this time — the wheel is a real draw, so sometimes it goes this way.',
  footnote: '',
  imageUrl: '',
  imageAlt: '',
};

export const DEFAULT_BACKGROUND: DialogBackground = 'paper';

/** The dialog's own background. Two tokens, both defined in globals.css. */
export type DialogBackground = 'paper' | 'velvet';

export type ResolvedPresentation = typeof PRESENTATION_DEFAULTS & { background: DialogBackground };

/** Stored value wins, then the default. A blank string counts as "not set". */
export function resolvePresentation(raw: unknown): ResolvedPresentation {
  const parsed = presentationSchema.safeParse(raw ?? {});
  const stored = parsed.success ? parsed.data : {};
  const pick = <K extends keyof typeof PRESENTATION_DEFAULTS>(key: K): string => {
    const value = stored[key as keyof typeof stored];
    return typeof value === 'string' && value.trim() !== '' ? value : (PRESENTATION_DEFAULTS[key] as string);
  };
  return {
    eyebrow: pick('eyebrow'),
    heading: pick('heading'),
    subheading: pick('subheading'),
    phoneLabel: pick('phoneLabel'),
    phoneHint: pick('phoneHint'),
    buttonLabel: pick('buttonLabel'),
    winHeading: pick('winHeading'),
    loseMessage: pick('loseMessage'),
    footnote: pick('footnote'),
    imageUrl: pick('imageUrl'),
    imageAlt: pick('imageAlt'),
    background: stored.background ?? DEFAULT_BACKGROUND,
  };
}
