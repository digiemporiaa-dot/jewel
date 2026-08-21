import Decimal from 'decimal.js';

/**
 * GST computation for a jewellery invoice.
 *
 * Pure and dependency-free apart from decimal.js, so every rule below is
 * directly testable. Money never touches a JS float here, for the same reason it
 * does not in `lib/pricing.ts`.
 *
 * The rule that matters: a sale is **intra-state** when the buyer's state equals
 * the seller's registered state, and is then split CGST + SGST at half the rate
 * each. Otherwise it is **inter-state** and carries IGST at the full rate. Get
 * this wrong and the invoice is wrong in a way that surfaces in a GST audit,
 * long after the goods have shipped and the money has been banked.
 */

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

const money = (d: Decimal): Decimal => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export type TaxKind = 'INTRA_STATE' | 'INTER_STATE';

export type HsnSummaryRow = {
  hsnCode: string;
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  totalTax: string;
};

export type TaxBreakup = {
  kind: TaxKind;
  /** GST state code the goods are supplied to, e.g. "07". */
  placeOfSupplyCode: string;
  placeOfSupplyName: string;
  sellerStateCode: string;
  /** Full GST rate, e.g. "3.00". Halved across CGST/SGST when intra-state. */
  gstRate: string;
  cgstRate: string;
  sgstRate: string;
  igstRate: string;
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  totalTax: string;
  hsnSummary: HsnSummaryRow[];
};

export type TaxLineInput = {
  hsnCode: string;
  /** Value net of GST for this line, as a decimal string. */
  taxableValue: string;
  /** Full GST rate for this line, e.g. "3". */
  gstRate: string;
};

/**
 * The GST state codes, indexed by the two-digit code used on every invoice.
 *
 * Included in full because the seller's code and the buyer's state both have to
 * resolve for the split to be derivable, and a partial list would silently
 * misclassify sales to whichever state was left out.
 */
export const GST_STATE_CODES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab',
  '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi',
  '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram',
  '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep',
  '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh',
  '38': 'Ladakh', '97': 'Other Territory',
};

/** Lower-cased state name → code, for resolving a typed shipping address. */
const CODE_BY_NAME: Record<string, string> = Object.entries(GST_STATE_CODES).reduce<Record<string, string>>(
  (acc, [code, name]) => {
    acc[name.toLowerCase()] = code;
    return acc;
  },
  {
    // Spellings shoppers actually type, and the older names still in wide use.
    'orissa': '21',
    'pondicherry': '34',
    'uttaranchal': '05',
    'nct of delhi': '07',
    'new delhi': '07',
    'delhi ncr': '07',
    'jammu & kashmir': '01',
    'dadra and nagar haveli': '26',
    'daman and diu': '26',
    'andaman & nicobar islands': '35',
  }
);

/**
 * Resolve a shipping address's state to a GST code.
 *
 * Accepts either the code itself or the state name, because addresses are typed
 * by shoppers and are not a controlled vocabulary. Returns null when it cannot
 * be resolved — the caller must decide what to do rather than have a wrong
 * default silently chosen for it.
 */
export function resolveStateCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (raw === '') return null;

  // Already a code, with or without a leading zero ("7" → "07").
  if (/^\d{1,2}$/.test(raw)) {
    const padded = raw.padStart(2, '0');
    return GST_STATE_CODES[padded] ? padded : null;
  }

  const normalised = raw.toLowerCase().replace(/\s+/g, ' ');
  return CODE_BY_NAME[normalised] ?? null;
}

export function stateName(code: string | null | undefined): string {
  if (!code) return 'Unknown';
  return GST_STATE_CODES[code] ?? 'Unknown';
}

/** Intra-state when buyer and seller are in the same state. */
export function taxKindFor(sellerStateCode: string, buyerStateCode: string): TaxKind {
  return sellerStateCode === buyerStateCode ? 'INTRA_STATE' : 'INTER_STATE';
}

/**
 * Build the full tax breakup for an order.
 *
 * Tax is computed **per line and then summed**, not by applying a rate to the
 * order total. Lines can carry different HSN codes and rates, and the HSN
 * summary a GST invoice must show is only derivable line by line. Each line's
 * tax is rounded to paise before summing, so the printed lines add up to the
 * printed total exactly — a total computed at full precision and rounded once
 * can disagree with the visible rows by a paisa, which is the kind of thing that
 * gets an invoice queried.
 */
export function buildTaxBreakup(params: {
  lines: TaxLineInput[];
  sellerStateCode: string;
  buyerStateCode: string;
}): TaxBreakup {
  const kind = taxKindFor(params.sellerStateCode, params.buyerStateCode);
  const intra = kind === 'INTRA_STATE';

  const byHsn = new Map<string, { taxable: Decimal; cgst: Decimal; sgst: Decimal; igst: Decimal }>();

  let taxableTotal = new Decimal(0);
  let cgstTotal = new Decimal(0);
  let sgstTotal = new Decimal(0);
  let igstTotal = new Decimal(0);
  let representativeRate = new Decimal(0);

  for (const line of params.lines) {
    const taxable = money(new Decimal(line.taxableValue || '0'));
    const rate = new Decimal(line.gstRate || '0');
    if (rate.gt(representativeRate)) representativeRate = rate;

    const fullTax = money(taxable.times(rate).div(100));

    let cgst = new Decimal(0);
    let sgst = new Decimal(0);
    let igst = new Decimal(0);

    if (intra) {
      // Half each. Rounding half the tax twice can differ from rounding the
      // whole by a paisa, so CGST is rounded and SGST takes the remainder —
      // CGST + SGST then always equals the line's total tax exactly.
      cgst = money(fullTax.div(2));
      sgst = money(fullTax.minus(cgst));
    } else {
      igst = fullTax;
    }

    taxableTotal = taxableTotal.plus(taxable);
    cgstTotal = cgstTotal.plus(cgst);
    sgstTotal = sgstTotal.plus(sgst);
    igstTotal = igstTotal.plus(igst);

    const key = line.hsnCode || 'UNKNOWN';
    const row = byHsn.get(key) ?? {
      taxable: new Decimal(0), cgst: new Decimal(0), sgst: new Decimal(0), igst: new Decimal(0),
    };
    row.taxable = row.taxable.plus(taxable);
    row.cgst = row.cgst.plus(cgst);
    row.sgst = row.sgst.plus(sgst);
    row.igst = row.igst.plus(igst);
    byHsn.set(key, row);
  }

  const half = representativeRate.div(2);

  return {
    kind,
    placeOfSupplyCode: params.buyerStateCode,
    placeOfSupplyName: stateName(params.buyerStateCode),
    sellerStateCode: params.sellerStateCode,
    gstRate: representativeRate.toFixed(2),
    cgstRate: intra ? half.toFixed(2) : '0.00',
    sgstRate: intra ? half.toFixed(2) : '0.00',
    igstRate: intra ? '0.00' : representativeRate.toFixed(2),
    taxableValue: taxableTotal.toFixed(2),
    cgst: cgstTotal.toFixed(2),
    sgst: sgstTotal.toFixed(2),
    igst: igstTotal.toFixed(2),
    totalTax: cgstTotal.plus(sgstTotal).plus(igstTotal).toFixed(2),
    hsnSummary: [...byHsn.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([hsnCode, row]) => ({
        hsnCode,
        taxableValue: row.taxable.toFixed(2),
        cgst: row.cgst.toFixed(2),
        sgst: row.sgst.toFixed(2),
        igst: row.igst.toFixed(2),
        totalTax: row.cgst.plus(row.sgst).plus(row.igst).toFixed(2),
      })),
  };
}

// ─── Invoice numbering ───────────────────────────────────────────────────────

/**
 * The Indian financial year for a date, as "2026-27".
 *
 * It runs April to March, so anything before 1 April belongs to the year that
 * started the previous April. Computed in **IST**, because an order placed at
 * 02:00 IST on 1 April is in the new financial year even though it is still
 * 31 March in UTC — and an invoice filed under the wrong year is a correction
 * that has to be made by hand.
 */
export function financialYearFor(date: Date): string {
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  const year = ist.getUTCFullYear();
  const month = ist.getUTCMonth(); // 0 = January
  const startYear = month >= 3 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/**
 * Format an invoice number, e.g. `MJ/2026-27/0001`.
 *
 * The prefix comes from settings so a redeployment for another jeweller gets its
 * own series rather than inheriting this one.
 */
export function formatInvoiceNumber(prefix: string, financialYear: string, sequence: number): string {
  const clean = prefix.trim().replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'INV';
  return `${clean}/${financialYear}/${String(sequence).padStart(4, '0')}`;
}

/** Derive a default series prefix from the brand name, e.g. "Maya Jewellers" → "MJ". */
export function invoicePrefixFromBrand(brandName: string): string {
  const initials = brandName
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
  return initials.slice(0, 4) || 'INV';
}
