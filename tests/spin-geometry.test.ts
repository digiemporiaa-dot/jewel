import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SPIN_TURNS, labelFlipped, labelRotation, pointerOffsetDegrees,
  restingRotation, segmentMidpoint, sliceAngle,
} from '@/lib/spin/geometry';
import { pickSegmentIndex, type SpinSegment } from '@/lib/spin/segments';

vi.mock('server-only', () => ({}));

/** Every wheel size the schema permits a customer to see, plus the awkward ones. */
const COUNTS = [3, 4, 5, 6, 8, 9] as const;

describe('where the wheel comes to rest', () => {
  for (const count of COUNTS) {
    it(`puts the winning midpoint under the pointer on a ${count}-segment wheel`, () => {
      for (let i = 0; i < count; i += 1) {
        const rotation = restingRotation(i, count);
        // 0° is the pointer. Within a degree, as the brief asks — in practice
        // these are exact, but floating-point slices of 360/9 should not be
        // asserted to the bit.
        expect(Math.abs(pointerOffsetDegrees(i, count, rotation))).toBeLessThan(1);
      }
    });

    it(`never rests on a boundary between two wedges on a ${count}-segment wheel`, () => {
      // The symptom that started this: a pointer resting between two prizes.
      // Half a slice of clearance either side is the whole wedge.
      const slice = sliceAngle(count);
      for (let i = 0; i < count; i += 1) {
        const offset = Math.abs(pointerOffsetDegrees(i, count, restingRotation(i, count)));
        expect(offset).toBeLessThan(slice / 2 - 0.5);
      }
    });

    it(`lands on the same angle with and without the flourish on a ${count}-segment wheel`, () => {
      // The reduced-motion path differs only by whole turns, which are invisible
      // in the final position.
      for (let i = 0; i < count; i += 1) {
        const spun = restingRotation(i, count, SPIN_TURNS);
        const still = restingRotation(i, count, 0);
        expect(((spun - still) % 360 + 360) % 360).toBe(0);
        expect(spun).toBeGreaterThan(still);
      }
    });

    it(`gives every segment a distinct resting angle on a ${count}-segment wheel`, () => {
      const angles = new Set(Array.from({ length: count }, (_, i) => restingRotation(i, count) % 360));
      expect(angles.size).toBe(count);
    });
  }

  for (const count of COUNTS) {
    it(`idles on a wedge rather than a boundary on a ${count}-segment wheel`, () => {
      // The wheel used to sit at 0° before anything happened, and 0° is the
      // boundary before segment 0 — its centre is half a slice further round.
      // Anyone whose spin was refused (already spun, rate limited) pressed the
      // button and saw the pointer resting between two prizes, on a wheel that
      // had never moved.
      expect(Math.abs(pointerOffsetDegrees(0, count, 0))).toBeCloseTo(sliceAngle(count) / 2, 6);
      expect(Math.abs(pointerOffsetDegrees(0, count, restingRotation(0, count, 0)))).toBeLessThan(1);
    });
  }

  it('agrees with the arithmetic the conic-gradient uses', () => {
    // Segment i occupies [i*slice, (i+1)*slice], so its centre is the midpoint
    // of that span — this is the one place the two are stated together.
    expect(segmentMidpoint(0, 4)).toBe(45);
    expect(segmentMidpoint(3, 4)).toBe(315);
    expect(segmentMidpoint(0, 6)).toBe(30);
    expect(restingRotation(0, 4, 0)).toBe(315);
    expect(restingRotation(1, 4, 0)).toBe(225);
  });
});

describe('where each label is drawn', () => {
  for (const count of COUNTS) {
    it(`sits each label on its own wedge on a ${count}-segment wheel`, () => {
      // The label element starts at 3 o'clock because of its own layout, so the
      // rotation applied to it is 90° less than the midpoint. Rotating by the
      // midpoint alone — which is what shipped — drew every label a quarter
      // turn clockwise of the wedge it names.
      for (let i = 0; i < count; i += 1) {
        const rendered = ((labelRotation(i, count) + 90) % 360 + 360) % 360;
        expect(rendered).toBeCloseTo(segmentMidpoint(i, count) % 360, 6);
      }
    });

    it(`keeps every label the right way up on a ${count}-segment wheel`, () => {
      for (let i = 0; i < count; i += 1) {
        const applied = ((labelRotation(i, count) % 360) + 360) % 360;
        const upsideDown = applied > 90 && applied < 270;
        expect(labelFlipped(i, count)).toBe(upsideDown);
      }
    });
  }
});

describe('the winning position comes from the draw, not from a label', () => {
  const seg = (label: string, weight: number): SpinSegment => ({
    label, weight, prize: { kind: 'NONE' },
  });

  it('resolves two segments sharing a label to distinct positions', () => {
    // A shop with "Better luck next time" twice is ordinary. Under the old
    // label lookup both spins animated to the first one.
    const segments = [seg('Better luck next time', 1), seg('10% off making', 1), seg('Better luck next time', 1)];
    expect(pickSegmentIndex(segments, 0)).toBe(0);
    expect(pickSegmentIndex(segments, 2)).toBe(2);
    expect(restingRotation(0, 3, 0)).not.toBe(restingRotation(2, 3, 0));
  });

  it('returns a real position for every roll in range', () => {
    const segments = [seg('a', 3), seg('b', 1), seg('c', 6)];
    const seen = new Set<number>();
    for (let roll = 0; roll < 10; roll += 1) {
      const i = pickSegmentIndex(segments, roll);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(segments.length);
      seen.add(i);
    }
    expect(seen).toEqual(new Set([0, 1, 2]));
    // Boundaries: weights 3/1/6 partition [0,10) as [0,3) [3,4) [4,10).
    expect(pickSegmentIndex(segments, 2)).toBe(0);
    expect(pickSegmentIndex(segments, 3)).toBe(1);
    expect(pickSegmentIndex(segments, 4)).toBe(2);
  });

  it('reports no position for an empty wheel instead of guessing zero', () => {
    expect(pickSegmentIndex([], 0)).toBe(-1);
  });
});

describe('the component refuses to animate to a guess', () => {
  const source = readFileSync(join(__dirname, '..', 'components/spin/SpinWheel.tsx'), 'utf8');

  it('drives the animation from the server index', () => {
    expect(source).toContain('const index = res.segmentIndex');
  });

  it('never derives the position by searching for the label', () => {
    // The exact shape of the original defect: a findIndex whose miss was
    // rounded up to segment 0.
    expect(source).not.toMatch(/findIndex\([^)]*label/);
    expect(source).not.toMatch(/Math\.max\(0,\s*segments\.findIndex/);
  });

  it('checks the index is a real position on the rendered wheel', () => {
    expect(source).toContain('index < segments.length');
    expect(source).toContain('Number.isInteger(index)');
  });

  it('does not start the wheel on a boundary', () => {
    expect(source).toContain('rotation ?? restingRotation(0, segments.length, 0)');
    expect(source).not.toContain('useState(0)');
  });

  it('shows the result instead of animating when it does not agree', () => {
    const guard = source.slice(source.indexOf('if (!agrees)'), source.indexOf('const reduced'));
    expect(guard).toContain('console.error');
    expect(guard).toContain('reveal()');
    expect(guard).not.toContain('setRotation');
  });
});
