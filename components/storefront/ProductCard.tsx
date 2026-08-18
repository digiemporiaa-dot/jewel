import Link from 'next/link';
import type { ProductCardData } from '@/lib/storefront';
import PriceLabel from '@/components/storefront/PriceLabel';
import ProductImage from '@/components/storefront/ProductImage';
import WishlistButton from '@/components/storefront/WishlistButton';
import { cn } from '@/lib/utils/cn';

export default function ProductCard({
  product,
  saved = false,
}: {
  product: ProductCardData;
  saved?: boolean;
}) {
  const madeToOrder = product.fulfilmentType === 'MADE_TO_ORDER';

  return (
    <div className="group relative">
      <div className="absolute right-2 top-2 z-10">
        <WishlistButton productId={product.id} initialSaved={saved} />
      </div>

      <Link href={`/p/${product.slug}`} className="block">
        <div className="relative aspect-[4/5] overflow-hidden border border-line bg-paper-2">
          <ProductImage
            src={product.image}
            alt={product.name}
            monogram={product.name.charAt(0)}
            className="h-full w-full transition-transform duration-500 group-hover:scale-[1.03]"
            sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw"
          />
          {/* Badges */}
          <div className="absolute left-2 top-2 flex flex-col gap-1">
            {product.isNewArrival && <Badge>New</Badge>}
            <Badge tone={madeToOrder ? 'muted' : 'solid'}>
              {madeToOrder ? 'Made to Order' : 'Ready to Ship'}
            </Badge>
          </div>
        </div>

        <div className="pt-3">
          <p className="text-[0.7rem] tracking-[0.1em] uppercase text-ink-soft">{product.categoryName}</p>
          <h3 className="mt-1 text-sm text-ink line-clamp-1 group-hover:text-brass transition-colors">{product.name}</h3>
          <div className="mt-1.5 flex items-center justify-between">
            <PriceLabel priceFrom={product.priceFrom} priceTo={product.priceTo} size="sm" />
            {madeToOrder && product.leadTimeDays && (
              <span className="text-[0.7rem] text-ink-soft">{product.leadTimeDays}d</span>
            )}
          </div>
        </div>
      </Link>
    </div>
  );
}

function Badge({ children, tone = 'solid' }: { children: React.ReactNode; tone?: 'solid' | 'muted' }) {
  return (
    <span
      className={cn(
        'inline-block text-[0.6rem] tracking-[0.1em] uppercase px-2 py-1 rounded-[2px]',
        tone === 'solid' ? 'bg-velvet text-paper' : 'bg-paper/90 text-ink-soft border border-line'
      )}
    >
      {children}
    </span>
  );
}
