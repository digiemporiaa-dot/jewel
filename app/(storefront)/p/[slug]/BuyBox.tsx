'use client';

import { useState, useMemo, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import SizeGuide from '@/components/storefront/SizeGuide';
import type { SizeGuideKind } from '@/lib/products/size-guide';
import { formatCurrency } from '@/lib/utils/format';
import { buildWhatsAppLink } from '@/lib/whatsapp';
import { WhatsAppIcon } from '@/components/icons';
import WhatsAppLink from '@/components/storefront/WhatsAppLink';
import WishlistButton from '@/components/storefront/WishlistButton';
import PriceLabel from '@/components/storefront/PriceLabel';
import PriceBreakup from './PriceBreakup';
import PincodeCheck from './PincodeCheck';
import { addToCartAction } from '@/app/(storefront)/cart/actions';
import type { DetailVariant } from '@/lib/product-detail';
import { trackEcommerce } from '@/lib/marketing/events';
import EmiNote from '@/components/storefront/EmiNote';
import { lowestEmi, allEmiOptions, type EmiTenure } from '@/lib/emi';

export type EmiConfig = { enabled: boolean; minAmount: string | null; tenures: EmiTenure[] };

export default function BuyBox({
  product,
  emiConfig,
}: {
  emiConfig: EmiConfig;
  product: {
    id: string; name: string; sku: string; slug: string;
    variants: DetailVariant[]; defaultVariantId: string | null;
    purityName: string | null; metalColor: string | null; certification: string | null;
    fulfilmentType: 'READY_TO_SHIP' | 'MADE_TO_ORDER'; leadTimeDays: number | null; gstInclusive: boolean;
    savedInitial: boolean;
    whatsappNumber: string | null; brandName: string; siteUrl: string;
    /** Which size chart to offer beside the selector, if any. */
    sizeGuide: SizeGuideKind | null;
  };
}) {
  const router = useRouter();
  const [variantId, setVariantId] = useState(product.defaultVariantId ?? product.variants[0]?.id ?? '');
  const [qty, setQty] = useState(1);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const variant = useMemo(() => product.variants.find((v) => v.id === variantId) ?? product.variants[0], [product.variants, variantId]);
  const madeToOrder = product.fulfilmentType === 'MADE_TO_ORDER';
  const hasVariantChoice = product.variants.length > 1;
  const canBuy = !!variant && (madeToOrder || variant.inStock) && !!variant.breakup;
  const maxQty = variant && !madeToOrder ? Math.max(1, variant.available) : 99;

  // `view_item` fires per variant: on a jewellery PDP the shopper switching
  // between 18K and 22K is a materially different item at a different price, and
  // reporting only the default would understate what was actually browsed.
  useEffect(() => {
    if (!variant?.breakup) return;
    trackEcommerce('view_item', {
      currency: 'INR',
      value: Number(variant.breakup.unitTotal),
      items: [{
        item_id: variant.sku,
        item_name: product.name,
        price: Number(variant.breakup.unitTotal),
        quantity: 1,
        ...(product.purityName ? { item_variant: product.purityName } : {}),
      }],
    });
  }, [variant?.sku, variant?.breakup, product.name, product.purityName]);

  // Recomputed per selected variant: an 18K and a 22K version of the same ring
  // are different money, and quoting the default variant's EMI against another
  // variant's price would be wrong on screen.
  const emiParams = {
    amount: variant?.breakup?.unitTotal ?? '0',
    enabled: emiConfig.enabled,
    minAmount: emiConfig.minAmount,
    tenures: emiConfig.tenures,
  };
  const emiBest = lowestEmi(emiParams);
  const emiOptions = allEmiOptions(emiParams);

  const whatsappLink = buildWhatsAppLink({
    whatsappNumber: product.whatsappNumber,
    brandName: product.brandName,
    productName: product.name,
    sku: variant?.sku ?? product.sku,
    price: variant?.breakup ? formatCurrency(variant.breakup.unitTotal) : null,
    productUrl: `${product.siteUrl}/p/${product.slug}`,
  });

  function add(redirect: boolean) {
    if (!variant) return;
    setMsg(null);
    start(async () => {
      const res = await addToCartAction({ productId: product.id, variantId: variant.id, quantity: qty });
      if (res.ok) {
        // Only on success — reporting an add that the server rejected (out of
        // stock, say) would put items in the funnel that never entered a cart.
        if (variant.breakup) {
          trackEcommerce('add_to_cart', {
            currency: 'INR',
            value: Number(variant.breakup.unitTotal) * qty,
            items: [{
              item_id: variant.sku,
              item_name: product.name,
              price: Number(variant.breakup.unitTotal),
              quantity: qty,
            }],
          });
        }
        if (redirect) router.push('/checkout');
        else { setMsg('Added to your bag'); router.refresh(); }
      } else setMsg(res.error ?? 'Could not add to bag');
    });
  }

  return (
    <div className="space-y-5">
      {/* Price */}
      <div>
        {variant?.breakup ? (
          <p className="font-heading text-3xl">{formatCurrency(variant.breakup.unitTotal)}</p>
        ) : (
          <PriceLabel priceFrom={product.variants[0]?.breakup?.unitTotal ?? null} priceTo={null} size="lg" />
        )}
        <p className="text-xs text-ink-soft mt-1">{product.gstInclusive ? 'Inclusive of GST' : 'Plus GST as shown'} · Priced on today’s live rate</p>
      </div>

      {/* Variant / size selector */}
      {hasVariantChoice && (
        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <p className="text-xs tracking-[0.1em] uppercase text-ink-soft">
              {product.variants.some((v) => v.size) ? 'Select size' : 'Select option'}
            </p>
            {/* Beside the sizes, where the question is actually being asked.
                Wrong-size orders are the main avoidable return in this
                category, and a photograph cannot settle it. */}
            {product.sizeGuide && <SizeGuide kind={product.sizeGuide} />}
          </div>
          <div className="flex flex-wrap gap-2">
            {product.variants.map((v) => {
              const disabled = !madeToOrder && !v.inStock;
              return (
                <button
                  key={v.id}
                  onClick={() => { setVariantId(v.id); setQty(1); }}
                  disabled={disabled}
                  className={cn(
                    'min-w-[3rem] px-3 py-2 text-sm border rounded-[2px] transition-colors',
                    v.id === variantId ? 'border-velvet bg-velvet text-paper' : 'border-line hover:border-brass',
                    disabled && 'opacity-40 line-through cursor-not-allowed'
                  )}
                >
                  {v.size ?? v.label ?? v.sku}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* A single-size ring still raises the same question, and there is no
          selector to hang the link off. */}
      {!hasVariantChoice && product.sizeGuide && <SizeGuide kind={product.sizeGuide} />}

      {/* Availability */}
      <div className="text-sm">
        {madeToOrder ? (
          <p className="text-ink-soft">Made to order{product.leadTimeDays ? ` · ships in ~${product.leadTimeDays} days` : ''}</p>
        ) : variant?.inStock ? (
          <p className="text-velvet">In stock · ready to ship</p>
        ) : (
          <p className="text-red-700">Currently out of stock</p>
        )}
      </div>

      {/* Quantity */}
      <div className="flex items-center gap-4">
        <span className="text-xs tracking-[0.1em] uppercase text-ink-soft">Qty</span>
        <div className="inline-flex items-center border border-line">
          <button aria-label="Decrease" onClick={() => setQty((q) => Math.max(1, q - 1))} className="px-3 py-2 hover:bg-paper-2">−</button>
          <span className="px-4 py-2 text-sm min-w-[3rem] text-center">{qty}</span>
          <button aria-label="Increase" onClick={() => setQty((q) => Math.min(maxQty, q + 1))} disabled={qty >= maxQty} className="px-3 py-2 hover:bg-paper-2 disabled:opacity-40">+</button>
        </div>
      </div>

      {/* Actions */}
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => add(false)} disabled={!canBuy || pending} className="btn-outline">
          {pending ? '…' : 'Add to Bag'}
        </button>
        <button onClick={() => add(true)} disabled={!canBuy || pending} className="btn-primary">
          Buy Now
        </button>
      </div>
      <div className="flex items-center gap-3">
        <WishlistButton productId={product.id} initialSaved={product.savedInitial} variant="full" className="flex-1" />
        {whatsappLink && (
          <WhatsAppLink
            href={whatsappLink}
            productId={product.id}
            className="btn-outline flex-1 justify-center"
          >
            <WhatsAppIcon width={18} height={18} /> Enquire
          </WhatsAppLink>
        )}
      </div>
      {msg && <p className="text-sm text-ink-soft">{msg}</p>}

      {/* EMI — renders nothing when disabled, unconfigured, or below the
          bank's minimum, so it needs no guard of its own. */}
      <EmiNote best={emiBest} options={emiOptions} className="mt-1" />

      {/* Price breakup */}
      {variant?.breakup && (
        <PriceBreakup breakup={variant.breakup} weight={variant.weight} purity={product.purityName} />
      )}

      {/* Pincode */}
      <PincodeCheck />

      {product.certification && (
        <p className="text-xs text-ink-soft border-t border-line pt-4">✓ {product.certification}</p>
      )}

      {/* Mobile sticky CTA (brief §12/§63) */}
      <div className="lg:hidden fixed inset-x-0 bottom-0 z-30 bg-paper border-t border-line-strong px-4 py-2.5 flex items-center gap-3">
        <div className="min-w-0">
          <p className="text-[0.65rem] text-ink-soft leading-none">{madeToOrder ? 'Made to order' : variant?.inStock ? 'In stock' : 'Sold out'}</p>
          <p className="font-heading text-lg leading-tight">{variant?.breakup ? formatCurrency(variant.breakup.unitTotal) : '—'}</p>
        </div>
        <div className="flex-1 grid grid-cols-2 gap-2">
          <button onClick={() => add(false)} disabled={!canBuy || pending} className="btn-outline text-xs py-2.5">Add</button>
          <button onClick={() => add(true)} disabled={!canBuy || pending} className="btn-primary text-xs py-2.5">Buy Now</button>
        </div>
      </div>
      <div className="lg:hidden h-16" aria-hidden />
    </div>
  );
}
