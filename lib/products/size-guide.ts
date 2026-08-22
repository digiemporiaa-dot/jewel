/**
 * Ring and bangle size charts.
 *
 * Wrong-size orders are the main avoidable return in this category, and unlike a
 * colour or a clasp it is not something a photograph can settle. The chart is
 * reference data — Indian ring sizes with their inside diameter and
 * circumference, and the standard bangle sizes — so it lives in code rather than
 * in the CMS, where each shop would retype it and one of them would get a
 * millimetre wrong.
 *
 * Figures are the standard Indian ring scale: size 1 is 13.3mm inside diameter
 * and each size adds roughly 0.4mm, which is what the circumference column is
 * derived from (π × diameter, to one decimal).
 */

export type RingSize = { size: number; diameterMm: number; circumferenceMm: number };

function ring(size: number, diameterMm: number): RingSize {
  return {
    size,
    diameterMm,
    circumferenceMm: Math.round(Math.PI * diameterMm * 10) / 10,
  };
}

/**
 * Indian ring sizes 6–26, which covers essentially every adult finger sold to.
 * Sizes below 6 exist but are ordered by request, not chosen off a chart.
 */
export const RING_SIZES: RingSize[] = [
  ring(6, 14.3), ring(7, 14.7), ring(8, 15.1), ring(9, 15.5), ring(10, 15.9),
  ring(11, 16.3), ring(12, 16.7), ring(13, 17.1), ring(14, 17.5), ring(15, 17.9),
  ring(16, 18.3), ring(17, 18.7), ring(18, 19.1), ring(19, 19.5), ring(20, 19.9),
  ring(21, 20.3), ring(22, 20.7), ring(23, 21.1), ring(24, 21.5), ring(25, 21.9),
  ring(26, 22.3),
];

export type BangleSize = { size: string; diameterInches: number; diameterMm: number };

function bangle(size: string, diameterInches: number): BangleSize {
  return { size, diameterInches, diameterMm: Math.round(diameterInches * 25.4 * 10) / 10 };
}

/** The standard Indian bangle scale, quoted in inches by every jeweller. */
export const BANGLE_SIZES: BangleSize[] = [
  bangle('2.2', 2.125), bangle('2.4', 2.25), bangle('2.6', 2.375), bangle('2.8', 2.5),
  bangle('2.10', 2.625), bangle('2.12', 2.75), bangle('2.14', 2.875),
];

/**
 * Which chart, if any, a product should offer.
 *
 * Driven by the category slug and the product's own name, because that is what
 * the catalogue actually carries — there is no "wearable type" column, and
 * inventing one would mean every existing product needed backfilling before a
 * single shopper saw a chart.
 */
export type SizeGuideKind = 'ring' | 'bangle';

// Plurals matter: the catalogue's category slugs are "gold-rings" and
// "bangles", so a singular-only pattern would have matched nothing that ships.
const RING_WORDS = /\b(rings?|bands?|anguthi)\b/i;
const BANGLE_WORDS = /\b(bangles?|kadas?|kangan|bracelets?)\b/i;

export function sizeGuideFor(input: { categorySlug?: string | null; categoryName?: string | null; productName?: string | null }): SizeGuideKind | null {
  const haystack = [input.categorySlug, input.categoryName, input.productName]
    .filter(Boolean)
    .join(' ')
    .replace(/-/g, ' ');
  // Bangle first: "bangle ring set" is a bangle, and a bracelet is sized the
  // same way even though the word is different.
  if (BANGLE_WORDS.test(haystack)) return 'bangle';
  if (RING_WORDS.test(haystack)) return 'ring';
  return null;
}

/** How to measure, in the order somebody would actually do it. */
export const RING_STEPS: string[] = [
  'Wrap a strip of paper or a thin thread snugly around the base of the finger.',
  'Mark where it overlaps, then lay it flat against a ruler and read the length in millimetres.',
  'Find that length in the circumference column below — that row is your size.',
  'Measure at the end of the day, when fingers are at their largest, and not when your hands are cold.',
  'If the knuckle is much wider than the base, size up so the ring can pass over it.',
];

export const BANGLE_STEPS: string[] = [
  'Bring the thumb across to touch the little finger, as if slipping a bangle on.',
  'Wrap a thread around the widest part of that closed hand and mark the overlap.',
  'Measure the thread in millimetres and divide by 3.14 to get the diameter.',
  'Match that diameter to the chart below, rounding up rather than down.',
];

export const SIZE_GUIDE_TITLES: Record<SizeGuideKind, string> = {
  ring: 'Ring size guide',
  bangle: 'Bangle size guide',
};
