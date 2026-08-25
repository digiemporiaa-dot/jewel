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

/** A segment that wins nothing. Its presence is checked below. */
const nothingPrizeSchema = z.object({ kind: z.literal('NONE') });

export const segmentSchema = z
  .object({
    label: z.string().trim().min(1, 'Every segment needs a label').max(40),
    /**
     * Relative chance. Must be at least 1: a zero-weight segment is drawn on the
     * wheel, shown to the customer, and can never come up.
     */
    weight: z.number().int().min(1, 'Every segment must be winnable — use a weight of at least 1').max(10000),
    prize: z.discriminatedUnion('kind', [couponPrizeSchema, nothingPrizeSchema]),
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
