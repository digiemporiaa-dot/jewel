import { describe, it, expect } from 'vitest';
import {
  parseCertification, parseCertifications, purityMarkLabel, ISSUERS, BIS_PURITY,
} from '@/lib/products/certification';
import {
  sizeGuideFor, RING_SIZES, BANGLE_SIZES, RING_STEPS, BANGLE_STEPS,
} from '@/lib/products/size-guide';

describe('reading a BIS hallmark', () => {
  it('reads the purity mark a jeweller typed', () => {
    const c = parseCertification('BIS Hallmark 916');
    expect(c?.issuer).toBe('BIS');
    expect(c?.purityMark).toBe('916');
  });

  it('reads a HUID and offers the only check that exists for one', () => {
    // BIS publishes no per-HUID web lookup; the number is checked in the BIS
    // Care app. Linking a homepage and calling it verification would be worse
    // than saying so.
    const c = parseCertification('BIS Hallmark 916 HUID AZ4K9P');
    expect(c?.number).toBe('AZ4K9P');
    expect(c?.verifyUrl).toBeNull();
    expect(c?.note).toMatch(/BIS Care app/);
  });

  it('reads a bare HUID with no label', () => {
    expect(parseCertification('Hallmarked · AZ4K9P')?.number).toBe('AZ4K9P');
  });

  it('does not mistake a purity mark for a HUID', () => {
    // "916" is six characters short of a HUID and all digits; reading it as an
    // identifier would print a purity mark as though it were a certificate.
    expect(parseCertification('BIS Hallmark 916')?.number).toBeNull();
  });

  it('maps every listed purity mark to a karat', () => {
    for (const [mark, karat] of Object.entries(BIS_PURITY)) {
      expect(purityMarkLabel(mark)).toBe(`${mark} · ${karat}`);
    }
  });

  it('prints an unknown mark plainly rather than guessing a karat', () => {
    expect(purityMarkLabel('833')).toBe('833');
    expect(purityMarkLabel(null)).toBeNull();
  });
});

describe('reading a laboratory report', () => {
  it('reads a GIA report number and pre-fills the check page', () => {
    const c = parseCertification('GIA 2141438171');
    expect(c?.issuer).toBe('GIA');
    expect(c?.number).toBe('2141438171');
    expect(c?.verifyUrl).toBe('https://www.gia.edu/report-check?reportno=2141438171');
  });

  it('sends an IGI report to IGI, which does not take the number in the URL', () => {
    const c = parseCertification('IGI 12345678');
    expect(c?.number).toBe('12345678');
    expect(c?.verifyUrl).toBe(ISSUERS.IGI.verifyUrl);
  });

  it('never invents a link for an issuer with no check page', () => {
    // A verification link that lands nowhere is a trust signal that fails.
    for (const c of [parseCertification('HRD 1234567890'), parseCertification('SGL 998877665')]) {
      expect(c?.number).toBeTruthy();
      expect(c?.verifyUrl).toBeNull();
    }
  });

  it('does not read the issuer name as part of the number', () => {
    expect(parseCertification('IGI-2141438171')?.number).toBe('2141438171');
  });

  it('prefers the specific issuer when a piece is both certified and hallmarked', () => {
    // An IGI-certified diamond ring is also hallmarked; the report is the more
    // specific claim, so it takes the label.
    expect(parseCertification('IGI Certified · BIS Hallmarked')?.issuer).toBe('IGI');
  });
});

describe('text this does not recognise', () => {
  it('is shown as written rather than dressed up as a certificate', () => {
    const c = parseCertification('Certified by our in-house assayer');
    expect(c?.issuer).toBeNull();
    expect(c?.verifyUrl).toBeNull();
    expect(c?.label).toBe('Certified by our in-house assayer');
  });

  it('is nothing when there is nothing', () => {
    expect(parseCertification('')).toBeNull();
    expect(parseCertification('   ')).toBeNull();
    expect(parseCertification(null)).toBeNull();
    expect(parseCertification(undefined)).toBeNull();
  });
});

describe('a product with several certificates', () => {
  it('keeps the hallmark and the stone report side by side', () => {
    const list = parseCertifications(['BIS Hallmark 750', 'IGI 12345678']);
    expect(list.map((c) => c.issuer)).toEqual(['BIS', 'IGI']);
  });

  it('shows one report once, however many stones share it', () => {
    const list = parseCertifications(['IGI 12345678', 'IGI 12345678', 'IGI 12345678']);
    expect(list).toHaveLength(1);
  });

  it('drops the blanks a half-filled row leaves behind', () => {
    expect(parseCertifications([null, '', '   ', undefined])).toEqual([]);
  });
});

describe('which size chart a product offers', () => {
  it('offers rings to rings', () => {
    expect(sizeGuideFor({ categorySlug: 'gold-rings' })).toBe('ring');
    expect(sizeGuideFor({ productName: 'Solitaire Engagement Ring' })).toBe('ring');
  });

  it('offers bangles to bangles, kadas and bracelets', () => {
    expect(sizeGuideFor({ categorySlug: 'bangles' })).toBe('bangle');
    expect(sizeGuideFor({ productName: 'Gold Kada' })).toBe('bangle');
    expect(sizeGuideFor({ categoryName: 'Bracelets' })).toBe('bangle');
  });

  it('offers nothing to a piece that is not sized', () => {
    expect(sizeGuideFor({ categorySlug: 'necklaces', productName: 'Temple Necklace' })).toBeNull();
    expect(sizeGuideFor({})).toBeNull();
  });

  it('reads a hyphenated slug as words', () => {
    expect(sizeGuideFor({ categorySlug: 'diamond-rings' })).toBe('ring');
  });
});

describe('the charts themselves', () => {
  it('run in order, with no gaps', () => {
    for (let i = 1; i < RING_SIZES.length; i++) {
      expect(RING_SIZES[i]!.size).toBe(RING_SIZES[i - 1]!.size + 1);
      expect(RING_SIZES[i]!.diameterMm).toBeGreaterThan(RING_SIZES[i - 1]!.diameterMm);
    }
  });

  it('derive circumference from diameter rather than being typed twice', () => {
    // Two hand-typed columns are two columns that can disagree, and a
    // millimetre of disagreement is a returned ring.
    for (const r of RING_SIZES) {
      expect(r.circumferenceMm).toBeCloseTo(Math.PI * r.diameterMm, 1);
    }
  });

  it('convert bangle inches to millimetres consistently', () => {
    for (const b of BANGLE_SIZES) {
      // Stored to one decimal, so half a tenth is the most it can be out —
      // with a hair of slack for binary floating point, which is why the
      // conversion is done once in the module rather than typed by hand.
      expect(Math.abs(b.diameterMm - b.diameterInches * 25.4)).toBeLessThan(0.0501);
    }
  });

  it('tell a shopper how to measure before showing them numbers', () => {
    expect(RING_STEPS.length).toBeGreaterThan(2);
    expect(BANGLE_STEPS.length).toBeGreaterThan(2);
  });
});
