/**
 * Reading the certification a jeweller typed, and turning it into a trust
 * signal a shopper can act on.
 *
 * `Product.certification` is free text — "BIS Hallmark 916", "IGI Certified",
 * "GIA 2141438171", "HUID AZ4K9P". It has been stored since the catalogue was
 * built and shown as a single grey row in the spec table, which is not what it
 * is for. In this category the hallmark and the certificate number are a
 * purchase-decision factor: a 22K chain with no visible hallmark is a chain
 * somebody has to take on trust.
 *
 * Everything here is a read of what is already stored. Nothing is invented: an
 * unrecognised string is shown as written rather than dressed up as a
 * certificate, and a number is only ever linked when the issuer publishes a page
 * that checks it.
 */

export type Issuer = 'BIS' | 'IGI' | 'GIA' | 'HRD' | 'SGL';

type IssuerInfo = {
  label: string;
  full: string;
  /**
   * The issuer's public report-check page, or null where there is not one.
   *
   * `numberParam` pre-fills the number when the issuer's page accepts it in the
   * query string. Where it does not, the shopper is sent to the page and the
   * number is displayed next to the link to copy. A verification link that
   * lands nowhere is worse than no link at all, so an issuer we do not have a
   * page for gets none.
   */
  verifyUrl: string | null;
  numberParam: string | null;
  /** Shown when there is no per-item URL — BIS verification is an app, not a page. */
  note: string | null;
};

export const ISSUERS: Record<Issuer, IssuerInfo> = {
  BIS: {
    label: 'BIS Hallmark',
    full: 'Bureau of Indian Standards',
    // BIS has no per-HUID web lookup: the six-character HUID is checked in the
    // BIS Care app. Saying so is more useful than linking to a homepage.
    verifyUrl: null,
    numberParam: null,
    note: 'Check this HUID in the BIS Care app',
  },
  IGI: {
    label: 'IGI',
    full: 'International Gemmological Institute',
    verifyUrl: 'https://www.igi.org/verify-your-report/',
    numberParam: null,
    note: null,
  },
  GIA: {
    label: 'GIA',
    full: 'Gemological Institute of America',
    verifyUrl: 'https://www.gia.edu/report-check',
    numberParam: 'reportno',
    note: null,
  },
  HRD: { label: 'HRD Antwerp', full: 'HRD Antwerp', verifyUrl: null, numberParam: null, note: null },
  SGL: { label: 'SGL', full: 'Solitaire Gemmological Laboratories', verifyUrl: null, numberParam: null, note: null },
};

export type Certificate = {
  issuer: Issuer | null;
  /** What to print as the badge label. */
  label: string;
  /** BIS purity mark: 916, 750, 585… */
  purityMark: string | null;
  /** HUID or report number, where one was typed. */
  number: string | null;
  /** Where a shopper can check it, or null. */
  verifyUrl: string | null;
  note: string | null;
  /** The stored text, unchanged, for anything not recognised. */
  raw: string;
};

/** BIS purity marks, and the karat each corresponds to. */
export const BIS_PURITY: Record<string, string> = {
  '999': '24K',
  '958': '23K',
  '916': '22K',
  '875': '21K',
  '750': '18K',
  '585': '14K',
  '375': '9K',
};

const ISSUER_PATTERNS: [Issuer, RegExp][] = [
  ['GIA', /\bGIA\b/i],
  ['IGI', /\bIGI\b/i],
  ['HRD', /\bHRD\b/i],
  ['SGL', /\bSGL\b/i],
  // Last, because "BIS Hallmark" is the loosest match and an IGI-certified
  // diamond ring is also hallmarked — the more specific issuer wins the label.
  ['BIS', /\b(BIS|hallmark(ed)?|HUID)\b/i],
];

const PURITY_MARK = /\b(999|958|916|875|750|585|375)\b/;
/** BIS HUID: six alphanumeric characters, always mixed, e.g. AZ4K9P. */
const HUID = /\bHUID[:\s-]*([A-Z0-9]{6})\b|\b(?=[A-Z0-9]{6}\b)(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])([A-Z0-9]{6})\b/;
/** Laboratory report numbers: a long run of digits, sometimes prefixed. */
const REPORT_NUMBER = /\b(\d{7,15})\b/;

/**
 * Parse one stored certification string.
 *
 * Returns null only for nothing at all. Text that names no issuer still comes
 * back — as `raw`, with no badge and no link — because a jeweller who typed
 * something meant it to be read.
 */
export function parseCertification(value: string | null | undefined): Certificate | null {
  const raw = (value ?? '').trim();
  if (raw === '') return null;

  const issuer = ISSUER_PATTERNS.find(([, re]) => re.test(raw))?.[0] ?? null;
  const info = issuer ? ISSUERS[issuer] : null;

  const purityMark = issuer === 'BIS' || issuer === null ? PURITY_MARK.exec(raw)?.[1] ?? null : null;

  let number: string | null = null;
  if (issuer === 'BIS') {
    const m = HUID.exec(raw.toUpperCase());
    // Group 1 is the labelled form ("HUID AZ4K9P"), group 2 the bare one.
    number = m ? m[1] ?? m[2] ?? null : null;
  } else if (issuer) {
    // Strip the issuer's own name first, so "IGI" is never read as part of the
    // number, and a purity mark elsewhere in the string is not mistaken for one.
    const rest = raw.replace(new RegExp(`\\b${issuer}\\b`, 'ig'), ' ');
    number = REPORT_NUMBER.exec(rest)?.[1] ?? null;
  }

  const verifyUrl = number && info?.verifyUrl
    ? info.numberParam
      ? `${info.verifyUrl}?${info.numberParam}=${encodeURIComponent(number)}`
      : info.verifyUrl
    : info?.verifyUrl ?? null;

  return {
    issuer,
    label: info?.label ?? raw,
    purityMark,
    number,
    verifyUrl,
    note: number && info?.note ? info.note : null,
    raw,
  };
}

/**
 * Every certificate on a product, deduplicated.
 *
 * A ring can carry both a BIS hallmark on the gold and an IGI report on the
 * stone, and several diamonds on one piece often share a report number.
 */
export function parseCertifications(values: (string | null | undefined)[]): Certificate[] {
  const out: Certificate[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const parsed = parseCertification(value);
    if (!parsed) continue;
    const key = `${parsed.issuer ?? 'raw'}:${parsed.number ?? parsed.purityMark ?? parsed.raw.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed);
  }
  return out;
}

/** "916" reads as a number to most shoppers; "916 · 22K gold" reads as purity. */
export function purityMarkLabel(mark: string | null): string | null {
  if (!mark) return null;
  const karat = BIS_PURITY[mark];
  return karat ? `${mark} · ${karat}` : mark;
}
