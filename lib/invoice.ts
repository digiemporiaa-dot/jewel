import 'server-only';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { prisma } from '@/lib/prisma';
import { getStoreSettings } from '@/lib/store';

/**
 * Generate a PDF invoice from the order's IMMUTABLE snapshot — never recomputed
 * from current rates (brief §38). Uses pdf-lib (pure JS, portable).
 */
export async function generateInvoicePdf(orderId: string): Promise<Uint8Array | null> {
  const [order, store] = await Promise.all([
    prisma.order.findUnique({ where: { id: orderId }, include: { items: true } }),
    getStoreSettings(),
  ]);
  if (!order) return null;

  const inr = (v: unknown) => `INR ${Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.09, 0.08, 0.07);
  const soft = rgb(0.37, 0.35, 0.31);
  const line = rgb(0.8, 0.78, 0.73);
  let y = 800;

  const text = (s: string, x: number, size = 10, f = font, color = ink) => page.drawText(s, { x, y, size, font: f, color });
  const rule = () => { page.drawLine({ start: { x: 40, y: y }, end: { x: 555, y: y }, thickness: 0.6, color: line }); };

  // Header
  text(store.brandName, 40, 20, bold);
  text('TAX INVOICE', 460, 12, bold);
  y -= 16;
  if (store.addressLine) { text(`${store.addressLine}, ${store.city ?? ''} ${store.pincode ?? ''}`, 40, 9, font, soft); }
  y -= 12;
  if (store.gstin) text(`GSTIN: ${store.gstin}`, 40, 9, font, soft);
  text(`Invoice: ${order.orderNumber}`, 400, 9, font, soft);
  y -= 12;
  text(`Date: ${order.placedAt.toLocaleDateString('en-IN')}`, 400, 9, font, soft);
  y -= 10; rule(); y -= 20;

  // Bill to
  const ship = order.shippingAddress as { name?: string; line1?: string; city?: string; state?: string; pincode?: string; phone?: string };
  text('Bill To', 40, 10, bold); y -= 14;
  text(order.contactName, 40, 10); y -= 12;
  if (ship?.line1) { text(ship.line1, 40, 9, font, soft); y -= 11; }
  text(`${ship?.city ?? ''} ${ship?.state ?? ''} ${ship?.pincode ?? ''}`.trim(), 40, 9, font, soft); y -= 11;
  text(`Phone: ${order.contactPhone}`, 40, 9, font, soft);
  if (order.pan) { text(`PAN: ${order.pan}`, 300, 9, font, soft); }
  y -= 18; rule(); y -= 16;

  // Items header
  text('Item', 40, 9, bold); text('SKU', 250, 9, bold); text('Qty', 350, 9, bold); text('Amount', 480, 9, bold);
  y -= 6; rule(); y -= 16;

  for (const item of order.items) {
    text(item.nameSnapshot.slice(0, 34), 40, 9);
    text(item.skuSnapshot.slice(0, 18), 250, 9, font, soft);
    text(String(item.quantity), 355, 9);
    text(inr(item.lineTotal), 470, 9);
    y -= 12;
    const meta = [item.metalSnapshot, item.puritySnapshot, item.weightSnapshot ? `${item.weightSnapshot}g` : null].filter(Boolean).join(' · ');
    if (meta) { text(meta, 40, 8, font, soft); y -= 12; }
    if (y < 160) { y = 160; }
  }

  y -= 6; rule(); y -= 18;

  // Totals
  const totalRow = (label: string, value: string, strong = false) => {
    text(label, 360, strong ? 11 : 9, strong ? bold : font, strong ? ink : soft);
    text(value, 470, strong ? 11 : 9, strong ? bold : font);
    y -= strong ? 18 : 14;
  };
  totalRow('Subtotal (excl. GST)', inr(order.subtotal));
  totalRow('Making charges', inr(order.makingTotal));
  if (Number(order.discountTotal) > 0) totalRow('Discount', `- ${inr(order.discountTotal)}`);
  totalRow('GST', inr(order.gstTotal));
  totalRow('Shipping', Number(order.shippingTotal) === 0 ? 'Free' : inr(order.shippingTotal));
  totalRow('Grand Total', inr(order.grandTotal), true);
  totalRow('Amount Paid', inr(order.amountPaid));
  totalRow('Payment Method', String(order.paymentMethod));

  // Footer
  y = 60;
  text('This is a computer-generated invoice. Prices reflect the metal rate locked at purchase.', 40, 8, font, soft);

  return doc.save();
}
