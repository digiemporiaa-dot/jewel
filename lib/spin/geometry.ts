/**
 * Where the wheel stops, and where each label is drawn.
 *
 * Pulled out of the component because both of these are arithmetic that has to
 * be *right*, and neither is checkable by looking at a spinning wheel: a
 * pointer resting a wedge away from the prize looks like a wheel that stopped
 * somewhere, and only a customer comparing the pointer to the dialog notices.
 *
 * Two conventions, and everything below follows from them:
 *
 *  - **0° is 12 o'clock and angles increase clockwise.** That is where the
 *    pointer sits (`left-1/2 top-0`) and it is also where a CSS `conic-gradient`
 *    starts and which way it runs, so the two agree without an offset.
 *  - **Segment `i` occupies `[i * slice, (i + 1) * slice)`**, exactly as the
 *    gradient is built.
 */

/** Extra whole turns for the flourish. None under reduced motion. */
export const SPIN_TURNS = 4;

export function sliceAngle(count: number): number {
  return 360 / count;
}

/** The centre of segment `i`, in wheel-local degrees. */
export function segmentMidpoint(index: number, count: number): number {
  const slice = sliceAngle(count);
  return index * slice + slice / 2;
}

/**
 * How far to rotate the wheel so segment `i` finishes under the pointer.
 *
 * The pointer does not move, so the wheel has to bring the midpoint to 0°:
 * rotating clockwise by `360 - midpoint` does it. The whole turns are added on
 * top and are invisible in the final position — `restingRotation(i, n, 0)` and
 * `restingRotation(i, n, 4)` are the same angle modulo 360, which is what lets
 * the reduced-motion path land in exactly the same place without the spin.
 */
export function restingRotation(index: number, count: number, turns: number = SPIN_TURNS): number {
  return turns * 360 + (360 - segmentMidpoint(index, count));
}

/**
 * Where a segment's midpoint actually ends up on screen after that rotation.
 *
 * The inverse of the function above, written independently so the test checks
 * the arithmetic rather than restating it: 0 means "under the pointer".
 */
export function pointerOffsetDegrees(index: number, count: number, rotation: number): number {
  const at = (segmentMidpoint(index, count) + rotation) % 360;
  // Fold to (-180, 180] so "1° short of the pointer" reads as -1, not 359.
  const folded = ((at % 360) + 360) % 360;
  return folded > 180 ? folded - 360 : folded;
}

/**
 * The rotation applied to a label so it sits on its own wedge.
 *
 * The label element is `inset-0` with its text pushed to the right edge, so
 * before any rotation it sits at 3 o'clock — 90°, not 0°. Rotating it by the
 * midpoint alone therefore put every label a quarter-turn clockwise of the
 * wedge it names: on a six-segment wheel the text over the winning wedge
 * belonged to the segment two places away. Subtracting the 90° the layout
 * already contributes puts each label back on its own colour.
 */
export function labelRotation(index: number, count: number): number {
  return segmentMidpoint(index, count) - 90;
}

/**
 * Whether a label needs flipping to stay readable.
 *
 * Judged on the rotation the text actually receives, not on the midpoint —
 * those differ by the 90° above, and using the wrong one turns the labels on
 * one side of the wheel upside down.
 */
export function labelFlipped(index: number, count: number): boolean {
  const applied = ((labelRotation(index, count) % 360) + 360) % 360;
  return applied > 90 && applied < 270;
}
