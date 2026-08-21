import 'server-only';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { prisma } from '@/lib/prisma';
import { getStoreSettings } from '@/lib/store';
import { ensureInvoiceNumber } from '@/lib/tax/ensure-invoice';
import { stateName, type TaxBreakup } from '@/lib/tax/gst';

/**
 * Generate a GST tax invoice from the order's IMMUTABLE snapshot — never
 * recomputed from current rates (brief §38).
 *
 * A jewellery invoice that omits HSN, the place of supply, or the correct
 * CGST/SGST vs IGST split is what gets flagged in a GST audit, and it cannot be
 * corrected retroactively once the goods have shipped. Everything printed here
 * comes from `Order.taxBreakup`, frozen when the order was placed.
 */
export async function generateInvoicePdf(orderId: string): Promise<Uint8Array | null> {
  const [order, store] = await Promise.all([
    prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: { select: { hsnCode: true } } } } },
    }),
    getStoreSettings(),
  ]);
  if (!order) return null;

  // Allocated on first issue, not at checkout — see lib/tax/ensure-invoice.ts.
  const invoiceNumber = (await ensureInvoiceNumber(orderId)) ?? order.orderNumber;
  const tax = (order.taxBreakup as TaxBreakup | null) ?? null;

  const inr = (v: unknown) =>
    `INR ${Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.09, 0.08, 0.07);
  const soft = rgb(0.37, 0.35, 0.31);
  const line = rgb(0.8, 0.78, 0.73);
  let y = 800;

  const text = (s: string, x: number, size = 10, f = font, color = ink) =>
    page.drawText(s, { x, y, size, font: f, color });
  const rule = () => page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.6, color: line });

  // ── Header ─────────────────────────────────────────────────────────────────
  text(store.brandName, 40, 20, bold);
  text('TAX INVOICE', 448, 12, bold);
  y -= 16;
  if (store.addressLine) text(`${store.addressLine}, ${store.city ?? ''} ${store.pincode ?? ''}`, 40, 9, font, soft);
  text(`Invoice No: ${invoiceNumber}`, 360, 9, font, soft);
  y -= 12;
  if (store.gstin) text(`GSTIN: ${store.gstin}`, 40, 9, font, soft);
  text(`Date: ${order.placedAt.toLocaleDateString('en-IN')}`, 360, 9, font, soft);
  y -= 12;
  const sellerState = tax?.sellerStateCode ?? store.sellerStateCode;
  if (sellerState) text(`State: ${stateName(sellerState)} (${sellerState})`, 40, 9, font, soft);
  text(`Order: ${order.orderNumber}`, 360, 9, font, soft);
  y -= 10;
  rule();
  y -= 18;

  // ── Bill to + place of supply ──────────────────────────────────────────────
  const ship = order.shippingAddress as {
    name?: string; line1?: string; city?: string; state?: string; pincode?: string;
  };
  text('Bill To', 40, 10, bold);
  text('Place of Supply', 360, 10, bold);
  y -= 14;
  text(order.contactName, 40, 10);
  if (tax) text(`${tax.placeOfSupplyName} (${tax.placeOfSupplyCode})`, 360, 9);
  else if (ship?.state) text(String(ship.state), 360, 9);
  y -= 12;
  if (ship?.line1) { text(ship.line1, 40, 9, font, soft); }
  if (tax) text(tax.kind === 'INTRA_STATE' ? 'Intra-state supply' : 'Inter-state supply', 360, 8, font, soft);
  y -= 11;
  text(`${ship?.city ?? ''} ${ship?.state ?? ''} ${ship?.pincode ?? ''}`.trim(), 40, 9, font, soft);
  y -= 11;
  text(`Phone: ${order.contactPhone}`, 40, 9, font, soft);
  if (order.pan) text(`PAN: ${order.pan}`, 200, 9, font, soft);
  y -= 16;
  rule();
  y -= 16;

  // ── Line items, with HSN per line ──────────────────────────────────────────
  text('Item', 40, 9, bold);
  text('HSN', 250, 9, bold);
  text('Qty', 300, 9, bold);
  text('Taxable', 350, 9, bold);
  text('Amount', 480, 9, bold);
  y -= 6;
  rule();
  y -= 14;

  for (const item of order.items) {
    const gross = Number(item.lineTotal);
    const rate = Number(tax?.gstRate ?? store.gstPercentDefault);
    // The line's taxable value, derived from its own frozen breakup where
    // present so the figure matches what was charged.
    const breakup = item.priceBreakup as { taxable?: string } | null;
    const taxable = breakup?.taxable
      ? Number(breakup.taxable) * item.quantity
      : gross / (1 + rate / 100);

    text(item.nameSnapshot.slice(0, 32), 40, 9);
    text(item.product?.hsnCode ?? '—', 250, 9, font, soft);
    text(String(item.quantity), 305, 9);
    text(inr(taxable.toFixed(2)), 350, 9, font, soft);
    text(inr(item.lineTotal), 470, 9);
    y -= 12;

    const meta = [item.metalSnapshot, item.puritySnapshot, item.weightSnapshot ? `${item.weightSnapshot}g` : null]
      .filter(Boolean)
      .join(' · ');
    if (meta) { text(meta, 40, 8, font, soft); y -= 12; }
    if (y < 260) y = 260; // keep clear of the summary block below
  }

  y -= 6;
  rule();
  y -= 16;

  // ── Totals, with the tax split ─────────────────────────────────────────────
  const totalRow = (label: string, value: string, strong = false) => {
    text(label, 340, strong ? 11 : 9, strong ? bold : font, strong ? ink : soft);
    text(value, 470, strong ? 11 : 9, strong ? bold : font);
    y -= strong ? 18 : 13;
  };

  totalRow('Taxable value', inr(tax?.taxableValue ?? order.subtotal));
  if (Number(order.discountTotal) > 0) totalRow('Discount', `- ${inr(order.discountTotal)}`);

  if (tax && tax.kind === 'INTRA_STATE') {
    totalRow(`CGST @ ${tax.cgstRate}%`, inr(tax.cgst));
    totalRow(`SGST @ ${tax.sgstRate}%`, inr(tax.sgst));
  } else if (tax) {
    totalRow(`IGST @ ${tax.igstRate}%`, inr(tax.igst));
  } else {
    // Pre-dating the tax breakup: show what the order recorded rather than
    // inventing a split that was never charged.
    totalRow('GST', inr(order.gstTotal));
  }

  totalRow('Shipping', Number(order.shippingTotal) === 0 ? 'Free' : inr(order.shippingTotal));
  totalRow('Grand Total', inr(order.grandTotal), true);
  totalRow('Amount Paid', inr(order.amountPaid));
  totalRow('Payment', String(order.paymentMethod).replace('_', ' '));

  // ── HSN summary — required on a GST invoice ────────────────────────────────
  if (tax && tax.hsnSummary.length > 0) {
    y = Math.min(y, 200);
    rule();
    y -= 16;
    text('HSN Summary', 40, 10, bold);
    y -= 14;
    text('HSN', 40, 8, bold);
    text('Taxable Value', 120, 8, bold);
    if (tax.kind === 'INTRA_STATE') {
      text('CGST', 250, 8, bold);
      text('SGST', 330, 8, bold);
    } else {
      text('IGST', 250, 8, bold);
    }
    text('Total Tax', 450, 8, bold);
    y -= 4;
    rule();
    y -= 12;

    for (const row of tax.hsnSummary) {
      text(row.hsnCode, 40, 8);
      text(inr(row.taxableValue), 120, 8);
      if (tax.kind === 'INTRA_STATE') {
        text(inr(row.cgst), 250, 8);
        text(inr(row.sgst), 330, 8);
      } else {
        text(inr(row.igst), 250, 8);
      }
      text(inr(row.totalTax), 450, 8);
      y -= 12;
      if (y < 80) break;
    }
  }

  // ── Footer ─────────────────────────────────────────────────────────────────
  y = 56;
  text('This is a computer-generated invoice and does not require a signature.', 40, 8, font, soft);
  y -= 10;
  text('Prices reflect the metal rate locked at the time of purchase.', 40, 8, font, soft);

  return doc.save();
}
