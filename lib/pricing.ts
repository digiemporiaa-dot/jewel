import Decimal from 'decimal.js';

/**
 * ─── THE PRICING ENGINE ──────────────────────────────────────────────────────
 *
 * `calculatePrice()` is the ONLY place jewellery prices are calculated. No other
 * part of the application may compute a jewellery price independently (brief §14,
 * RULE 2). All arithmetic uses decimal.js — never JavaScript floating point
 * (brief RULE: "Never use JavaScript floating-point arithmetic for money").
 *
 * The function is pure and synchronous: callers gather inputs (current metal rate,
 * resolved making charge, diamonds, stones) from the database and pass them in.
 * See `lib/pricing/resolve.ts` for the server-side DB resolver.
 */

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export type DecimalInput = Decimal | number | string;

export type PricingMode = 'WEIGHT_BASED' | 'COMPONENT_BASED' | 'FIXED';
export type MakingChargeType = 'PERCENTAGE' | 'PER_GRAM' | 'FLAT';
export type DiscountType = 'PERCENTAGE' | 'FLAT';

export interface MakingChargeInput {
  type: MakingChargeType;
  value: DecimalInput;
  /** Floor: the making charge is never below this (brief §32 "Minimum charge"). */
  minCharge?: DecimalInput | null;
}

export interface DiamondInput {
  caratWeight: DecimalInput;
  pieces?: number;
  ratePerCarat: DecimalInput;
}

export interface StoneInput {
  /** Flat value for the stone(s); takes precedence over rate × pieces. */
  value?: DecimalInput | null;
  ratePerUnit?: DecimalInput | null;
  pieces?: number;
}

export interface DiscountInput {
  type: DiscountType;
  value: DecimalInput;
  maxDiscount?: DecimalInput | null;
}

export interface CalculatePriceInput {
  mode: PricingMode;
  /** Line quantity — the per-unit breakup is multiplied by this for `total`. */
  quantity?: number;

  // Metal (WEIGHT_BASED / COMPONENT_BASED)
  ratePerGram?: DecimalInput | null;
  netWeight?: DecimalInput | null; // grams
  wastagePct?: DecimalInput | null; // percent of metal value
  making?: MakingChargeInput | null;

  // Components (COMPONENT_BASED)
  diamonds?: DiamondInput[];
  stones?: StoneInput[];

  // FIXED
  fixedPrice?: DecimalInput | null;

  // Tax
  gstPercent: DecimalInput;
  gstInclusive?: boolean;

  // Discount (optional; product/coupon level)
  discount?: DiscountInput | null;
}

export interface PriceBreakup {
  mode: PricingMode;
  quantity: number;
  // Per-unit components (2dp strings — money never floats)
  metalValue: string;
  diamondValue: string;
  stoneValue: string;
  wastage: string;
  making: string;
  subtotal: string; // sum of components, per unit, pre-discount
  discount: string; // per unit
  taxable: string; // net of GST, per unit
  gst: string; // per unit
  gstPercent: string;
  unitTotal: string; // taxable + gst, per unit
  total: string; // unitTotal × quantity
  // Provenance
  rateUsed: string | null; // ₹/g used
  ratePerCarat: string | null; // blended ₹/carat used, if diamonds
  computedAt: string; // ISO timestamp
}

/** Thrown when a price cannot be computed. Callers show "Price on request". */
export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingError';
  }
}

const ZERO = new Decimal(0);

function d(value: DecimalInput | null | undefined, field: string): Decimal {
  if (value === null || value === undefined || value === '') {
    throw new PricingError(`Missing required numeric value: ${field}`);
  }
  try {
    const dec = new Decimal(value);
    if (dec.isNaN() || !dec.isFinite()) {
      throw new PricingError(`Invalid numeric value for ${field}: ${String(value)}`);
    }
    return dec;
  } catch (e) {
    if (e instanceof PricingError) throw e;
    throw new PricingError(`Invalid numeric value for ${field}: ${String(value)}`);
  }
}

function opt(value: DecimalInput | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') return ZERO;
  const dec = new Decimal(value);
  return dec.isNaN() || !dec.isFinite() ? ZERO : dec;
}

/** Round to 2 decimals (paise), half-up. Money display precision. */
function money(dec: Decimal): Decimal {
  return dec.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function computeMaking(making: MakingChargeInput, metalValue: Decimal, netWeight: Decimal): Decimal {
  let charge: Decimal;
  const value = d(making.value, 'making.value');
  switch (making.type) {
    case 'PERCENTAGE':
      charge = metalValue.times(value).div(100);
      break;
    case 'PER_GRAM':
      charge = value.times(netWeight);
      break;
    case 'FLAT':
      charge = value;
      break;
    default:
      throw new PricingError(`Unknown making charge type: ${String((making as { type?: unknown }).type)}`);
  }
  const min = opt(making.minCharge);
  return Decimal.max(charge, min);
}

export function calculatePrice(input: CalculatePriceInput): PriceBreakup {
  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new PricingError(`Invalid quantity: ${quantity}`);
  }

  const gstPercent = opt(input.gstPercent);
  if (gstPercent.lt(0)) throw new PricingError('GST percent cannot be negative');

  let metalValue = ZERO;
  let wastage = ZERO;
  let making = ZERO;
  let diamondValue = ZERO;
  let stoneValue = ZERO;
  let rateUsed: string | null = null;
  let ratePerCarat: string | null = null;
  let subtotal: Decimal;

  if (input.mode === 'FIXED') {
    const fixed = d(input.fixedPrice, 'fixedPrice');
    if (fixed.lt(0)) throw new PricingError('Fixed price cannot be negative');
    subtotal = money(fixed);
  } else {
    // WEIGHT_BASED and COMPONENT_BASED share the metal computation.
    const ratePerGram = d(input.ratePerGram, 'ratePerGram');
    const netWeight = d(input.netWeight, 'netWeight');
    if (ratePerGram.lt(0) || netWeight.lte(0)) {
      throw new PricingError('Rate per gram and net weight must be positive');
    }
    rateUsed = ratePerGram.toFixed(2);

    metalValue = money(ratePerGram.times(netWeight));
    wastage = money(metalValue.times(opt(input.wastagePct)).div(100));
    making = input.making ? money(computeMaking(input.making, metalValue, netWeight)) : ZERO;

    if (input.mode === 'COMPONENT_BASED') {
      let totalCarat = ZERO;
      let rawDiamond = ZERO;
      for (const dia of input.diamonds ?? []) {
        const carat = d(dia.caratWeight, 'diamond.caratWeight');
        const pieces = new Decimal(dia.pieces ?? 1);
        const rate = d(dia.ratePerCarat, 'diamond.ratePerCarat');
        const caratTotal = carat.times(pieces);
        rawDiamond = rawDiamond.plus(rate.times(caratTotal));
        totalCarat = totalCarat.plus(caratTotal);
      }
      diamondValue = money(rawDiamond);
      if (totalCarat.gt(0)) {
        ratePerCarat = rawDiamond.div(totalCarat).toFixed(2);
      }

      let rawStone = ZERO;
      for (const stone of input.stones ?? []) {
        if (stone.value !== null && stone.value !== undefined && stone.value !== '') {
          rawStone = rawStone.plus(opt(stone.value));
        } else if (stone.ratePerUnit !== null && stone.ratePerUnit !== undefined) {
          rawStone = rawStone.plus(opt(stone.ratePerUnit).times(new Decimal(stone.pieces ?? 1)));
        }
      }
      stoneValue = money(rawStone);
    }

    subtotal = metalValue.plus(wastage).plus(making).plus(diamondValue).plus(stoneValue);
  }

  // Discount (per unit), applied to the subtotal.
  let discount = ZERO;
  if (input.discount) {
    const dv = d(input.discount.value, 'discount.value');
    if (input.discount.type === 'PERCENTAGE') {
      discount = subtotal.times(dv).div(100);
    } else {
      discount = dv;
    }
    const cap = input.discount.maxDiscount;
    if (cap !== null && cap !== undefined && cap !== '') {
      discount = Decimal.min(discount, opt(cap));
    }
    discount = Decimal.min(discount, subtotal); // never exceed subtotal
    discount = money(Decimal.max(discount, ZERO));
  }

  // GST — inclusive extraction vs exclusive addition.
  let gst: Decimal;
  let taxable: Decimal;
  let unitTotal: Decimal;
  const grossAfterDiscount = subtotal.minus(discount);

  if (input.gstInclusive) {
    // subtotal already includes GST.
    const divisor = new Decimal(1).plus(gstPercent.div(100));
    taxable = money(grossAfterDiscount.div(divisor));
    gst = money(grossAfterDiscount.minus(taxable));
    unitTotal = money(grossAfterDiscount);
  } else {
    taxable = money(grossAfterDiscount);
    gst = money(taxable.times(gstPercent).div(100));
    unitTotal = money(taxable.plus(gst));
  }

  const total = money(unitTotal.times(quantity));

  return {
    mode: input.mode,
    quantity,
    metalValue: metalValue.toFixed(2),
    diamondValue: diamondValue.toFixed(2),
    stoneValue: stoneValue.toFixed(2),
    wastage: wastage.toFixed(2),
    making: making.toFixed(2),
    subtotal: money(subtotal).toFixed(2),
    discount: discount.toFixed(2),
    taxable: taxable.toFixed(2),
    gst: gst.toFixed(2),
    gstPercent: gstPercent.toFixed(2),
    unitTotal: unitTotal.toFixed(2),
    total: total.toFixed(2),
    rateUsed,
    ratePerCarat,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Rate-lock helper: given a lock timestamp and the store's rateLockMinutes,
 * report whether a checkout price snapshot is still valid (brief §15).
 */
export function isRateLockValid(
  lockedAt: Date | string,
  rateLockMinutes: number,
  now: Date = new Date()
): boolean {
  const locked = typeof lockedAt === 'string' ? new Date(lockedAt) : lockedAt;
  if (Number.isNaN(locked.getTime())) return false;
  const expiry = locked.getTime() + rateLockMinutes * 60_000;
  return now.getTime() <= expiry;
}
