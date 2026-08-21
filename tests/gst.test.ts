import { describe, it, expect } from 'vitest';
import {
  buildTaxBreakup, taxKindFor, resolveStateCode, stateName,
  financialYearFor, formatInvoiceNumber, invoicePrefixFromBrand,
  GST_STATE_CODES,
} from '@/lib/tax/gst';

const DELHI = '07';
const KARNATAKA = '29';

/** A single ₹1,00,000 line of jewellery at the standard 3%. */
const oneLakh = [{ hsnCode: '7113', taxableValue: '100000.00', gstRate: '3' }];

describe('intra-state vs inter-state', () => {
  it('splits CGST + SGST when buyer and seller share a state', () => {
    const tax = buildTaxBreakup({ lines: oneLakh, sellerStateCode: DELHI, buyerStateCode: DELHI });
    expect(tax.kind).toBe('INTRA_STATE');
    expect(tax.cgst).toBe('1500.00');
    expect(tax.sgst).toBe('1500.00');
    expect(tax.igst).toBe('0.00');
    expect(tax.cgstRate).toBe('1.50');
    expect(tax.sgstRate).toBe('1.50');
    expect(tax.igstRate).toBe('0.00');
    expect(tax.totalTax).toBe('3000.00');
  });

  it('charges IGST at the full rate when the states differ', () => {
    const tax = buildTaxBreakup({ lines: oneLakh, sellerStateCode: DELHI, buyerStateCode: KARNATAKA });
    expect(tax.kind).toBe('INTER_STATE');
    expect(tax.igst).toBe('3000.00');
    expect(tax.igstRate).toBe('3.00');
    expect(tax.cgst).toBe('0.00');
    expect(tax.sgst).toBe('0.00');
    expect(tax.totalTax).toBe('3000.00');
  });

  it('collects the same total tax either way — only the split differs', () => {
    const intra = buildTaxBreakup({ lines: oneLakh, sellerStateCode: DELHI, buyerStateCode: DELHI });
    const inter = buildTaxBreakup({ lines: oneLakh, sellerStateCode: DELHI, buyerStateCode: KARNATAKA });
    expect(intra.totalTax).toBe(inter.totalTax);
  });

  it('records the place of supply as the buyer state', () => {
    const tax = buildTaxBreakup({ lines: oneLakh, sellerStateCode: DELHI, buyerStateCode: KARNATAKA });
    expect(tax.placeOfSupplyCode).toBe('29');
    expect(tax.placeOfSupplyName).toBe('Karnataka');
    expect(tax.sellerStateCode).toBe('07');
  });

  it('classifies by state code directly', () => {
    expect(taxKindFor('07', '07')).toBe('INTRA_STATE');
    expect(taxKindFor('07', '27')).toBe('INTER_STATE');
  });
});

describe('rounding to paise', () => {
  it('keeps CGST + SGST equal to the line tax when the tax is an odd number of paise', () => {
    // ₹33,333.33 at 3% = ₹999.9999 → ₹1000.00 tax, which does not halve evenly
    // into two rounded values without care.
    const tax = buildTaxBreakup({
      lines: [{ hsnCode: '7113', taxableValue: '33333.33', gstRate: '3' }],
      sellerStateCode: DELHI, buyerStateCode: DELHI,
    });
    const sum = Number(tax.cgst) + Number(tax.sgst);
    expect(sum.toFixed(2)).toBe(tax.totalTax);
  });

  it('never emits more than two decimal places', () => {
    const tax = buildTaxBreakup({
      lines: [{ hsnCode: '7113', taxableValue: '12345.67', gstRate: '3' }],
      sellerStateCode: DELHI, buyerStateCode: KARNATAKA,
    });
    for (const value of [tax.taxableValue, tax.cgst, tax.sgst, tax.igst, tax.totalTax]) {
      expect(value).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it('makes the printed lines add up to the printed total', () => {
    // Three awkward amounts: the summary rows must reconcile to the footer.
    const tax = buildTaxBreakup({
      lines: [
        { hsnCode: '7113', taxableValue: '10000.01', gstRate: '3' },
        { hsnCode: '7113', taxableValue: '7777.77', gstRate: '3' },
        { hsnCode: '7117', taxableValue: '333.33', gstRate: '3' },
      ],
      sellerStateCode: DELHI, buyerStateCode: DELHI,
    });
    const summed = tax.hsnSummary.reduce((n, row) => n + Number(row.totalTax), 0);
    expect(summed.toFixed(2)).toBe(tax.totalTax);

    const taxable = tax.hsnSummary.reduce((n, row) => n + Number(row.taxableValue), 0);
    expect(taxable.toFixed(2)).toBe(tax.taxableValue);
  });
});

describe('HSN summary', () => {
  it('groups lines by HSN code', () => {
    const tax = buildTaxBreakup({
      lines: [
        { hsnCode: '7113', taxableValue: '50000.00', gstRate: '3' },
        { hsnCode: '7113', taxableValue: '25000.00', gstRate: '3' },
        { hsnCode: '7117', taxableValue: '1000.00', gstRate: '3' },
      ],
      sellerStateCode: DELHI, buyerStateCode: DELHI,
    });
    expect(tax.hsnSummary).toHaveLength(2);
    expect(tax.hsnSummary[0]?.hsnCode).toBe('7113');
    expect(tax.hsnSummary[0]?.taxableValue).toBe('75000.00');
    expect(tax.hsnSummary[1]?.hsnCode).toBe('7117');
  });

  it('does not silently drop a line with no HSN code', () => {
    // A missing code must be visible on the invoice, not swallowed.
    const tax = buildTaxBreakup({
      lines: [{ hsnCode: '', taxableValue: '1000.00', gstRate: '3' }],
      sellerStateCode: DELHI, buyerStateCode: DELHI,
    });
    expect(tax.hsnSummary[0]?.hsnCode).toBe('UNKNOWN');
    expect(tax.taxableValue).toBe('1000.00');
  });

  it('handles an empty order without throwing', () => {
    const tax = buildTaxBreakup({ lines: [], sellerStateCode: DELHI, buyerStateCode: DELHI });
    expect(tax.totalTax).toBe('0.00');
    expect(tax.hsnSummary).toEqual([]);
  });
});

describe('resolving a shipping address to a state code', () => {
  it('accepts the code itself, with or without a leading zero', () => {
    expect(resolveStateCode('07')).toBe('07');
    expect(resolveStateCode('7')).toBe('07');
    expect(resolveStateCode('29')).toBe('29');
  });

  it('accepts the state name, case- and space-insensitively', () => {
    expect(resolveStateCode('Delhi')).toBe('07');
    expect(resolveStateCode('  karnataka ')).toBe('29');
    expect(resolveStateCode('TAMIL NADU')).toBe('33');
  });

  it('accepts the spellings shoppers actually type', () => {
    // Addresses are free text, not a controlled vocabulary.
    expect(resolveStateCode('New Delhi')).toBe('07');
    expect(resolveStateCode('Orissa')).toBe('21');
    expect(resolveStateCode('Pondicherry')).toBe('34');
  });

  it('returns null rather than guessing', () => {
    // A wrong default here would misclassify the sale and produce a wrong split.
    expect(resolveStateCode('Atlantis')).toBeNull();
    expect(resolveStateCode('')).toBeNull();
    expect(resolveStateCode(null)).toBeNull();
    expect(resolveStateCode('99')).toBeNull();
  });

  it('covers every code in the table', () => {
    for (const [code, name] of Object.entries(GST_STATE_CODES)) {
      expect(resolveStateCode(code)).toBe(code);
      expect(resolveStateCode(name)).toBe(code);
      expect(stateName(code)).toBe(name);
    }
  });
});

describe('financial year', () => {
  it('runs April to March', () => {
    expect(financialYearFor(new Date('2026-04-01T00:00:00+05:30'))).toBe('2026-27');
    expect(financialYearFor(new Date('2026-12-31T12:00:00+05:30'))).toBe('2026-27');
    expect(financialYearFor(new Date('2027-03-31T23:59:00+05:30'))).toBe('2026-27');
    expect(financialYearFor(new Date('2027-04-01T00:00:00+05:30'))).toBe('2027-28');
  });

  it('uses IST, not UTC, at the year boundary', () => {
    // 02:00 IST on 1 April is still 31 March in UTC. Filing that invoice under
    // the previous financial year is a correction someone has to make by hand.
    const justAfterMidnightIST = new Date('2026-03-31T20:30:00Z'); // = 02:00 IST, 1 Apr
    expect(financialYearFor(justAfterMidnightIST)).toBe('2026-27');

    const justBefore = new Date('2026-03-31T18:00:00Z'); // = 23:30 IST, 31 Mar
    expect(financialYearFor(justBefore)).toBe('2025-26');
  });

  it('formats the second year as two digits', () => {
    expect(financialYearFor(new Date('2099-05-01T00:00:00+05:30'))).toBe('2099-00');
  });
});

describe('invoice number formatting', () => {
  it('pads the sequence to four digits', () => {
    expect(formatInvoiceNumber('MJ', '2026-27', 1)).toBe('MJ/2026-27/0001');
    expect(formatInvoiceNumber('MJ', '2026-27', 42)).toBe('MJ/2026-27/0042');
    expect(formatInvoiceNumber('MJ', '2026-27', 12345)).toBe('MJ/2026-27/12345');
  });

  it('strips anything that would break the series format', () => {
    expect(formatInvoiceNumber('m j/', '2026-27', 1)).toBe('MJ/2026-27/0001');
    expect(formatInvoiceNumber('', '2026-27', 1)).toBe('INV/2026-27/0001');
  });

  it('derives a per-brand prefix so a redeployment gets its own series', () => {
    expect(invoicePrefixFromBrand('Maya Jewellers')).toBe('MJ');
    expect(invoicePrefixFromBrand('Shree Ganesh Jewellery House')).toBe('SGJH');
    expect(invoicePrefixFromBrand('')).toBe('INV');
  });
});
