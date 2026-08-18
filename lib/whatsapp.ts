/**
 * Build a WhatsApp click-to-chat URL with a pre-filled enquiry (brief §26).
 * The number comes from StoreSetting — never hardcoded.
 */
export function buildWhatsAppLink(params: {
  whatsappNumber: string | null | undefined;
  brandName: string;
  productName: string;
  sku: string;
  price?: string | null;
  productUrl: string;
}): string | null {
  if (!params.whatsappNumber) return null;
  const digits = params.whatsappNumber.replace(/[^0-9]/g, '');
  if (!digits) return null;

  const lines = [
    `Hi ${params.brandName}, I'm interested in:`,
    params.productName,
    `SKU: ${params.sku}`,
    params.price ? `Price: ${params.price}` : null,
    params.productUrl,
  ].filter(Boolean);

  return `https://wa.me/${digits}?text=${encodeURIComponent(lines.join('\n'))}`;
}
