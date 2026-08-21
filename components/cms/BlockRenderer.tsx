import Link from 'next/link';
import type { CmsBlockType } from '@prisma/client';
import { cn } from '@/lib/utils/cn';
import ProductImage from '@/components/storefront/ProductImage';
import ProductRow from '@/components/storefront/ProductRow';
import { getFeaturedProducts, getNewArrivals, getBestSellers, getActiveCollections } from '@/lib/catalog';
import { parseBlockData } from '@/lib/cms/blocks';
import { styleFor } from '@/lib/cms/style';

/**
 * Renders a CMS block. Content comes from typed fields only — never raw HTML —
 * so a page can't inject markup or scripts. Invalid block data is skipped rather
 * than crashing the page.
 *
 * Presentation comes from `data.style`, resolved by lib/cms/style.ts into fixed
 * Tailwind classes. A block with no stored style resolves to the values that
 * reproduce its original appearance, so published pages do not shift.
 */
export default async function BlockRenderer({ type, data }: { type: CmsBlockType; data: unknown }) {
  const parsed = parseBlockData(type, data);
  if (!parsed.success) return null;
  const d = parsed.data as Record<string, never>;
  const s = styleFor(type, data);

  switch (type) {
    case 'HERO': {
      const b = d as unknown as { eyebrow: string; heading: string; subheading: string; imageUrl: string; ctaLabel: string; ctaHref: string };
      return (
        <section className={s.section}>
          <div className={cn(s.inner, 'grid lg:grid-cols-2 gap-8 items-center')}>
            <div className={s.align}>
              {b.eyebrow && <p className={cn('eyebrow', s.isDark && 'text-paper/70')}>{b.eyebrow}</p>}
              <h1 className={cn('mt-3 text-4xl sm:text-5xl', s.heading)}>{b.heading}</h1>
              {b.subheading && <p className={cn('mt-4 max-w-md', s.muted, s.style.align === 'center' && 'mx-auto')}>{b.subheading}</p>}
              {b.ctaLabel && b.ctaHref && (
                <Link href={b.ctaHref} className={cn('btn-primary mt-7 inline-flex', s.isDark && 'bg-brass hover:bg-brass/90')}>
                  {b.ctaLabel}
                </Link>
              )}
            </div>
            <div className={cn('aspect-[4/3] border overflow-hidden', s.border)}>
              <ProductImage src={b.imageUrl || null} alt={b.heading} monogram={b.heading.charAt(0)} className="w-full h-full" />
            </div>
          </div>
        </section>
      );
    }

    case 'RICH_TEXT': {
      const b = d as unknown as { heading: string; body: string };
      return (
        <section className={s.section}>
          <div className={s.inner}>
            <div className={cn('max-w-2xl', s.align, s.style.align === 'center' && 'mx-auto')}>
              {b.heading && <h2 className={cn('text-3xl mb-4', s.heading)}>{b.heading}</h2>}
              {b.body.split('\n').filter(Boolean).map((para, i) => (
                <p key={i} className={cn('leading-relaxed mb-3', s.muted)}>{para}</p>
              ))}
            </div>
          </div>
        </section>
      );
    }

    case 'IMAGE_TEXT': {
      const b = d as unknown as { heading: string; body: string; imageUrl: string; ctaLabel: string; ctaHref: string };
      return (
        <section className={s.section}>
          <div className={cn(s.inner, 'grid lg:grid-cols-2 gap-8 items-center')}>
            <div className={cn('aspect-[5/4] border overflow-hidden', s.border, s.style.mediaSide === 'right' && 'lg:order-2')}>
              <ProductImage src={b.imageUrl || null} alt={b.heading || 'Image'} monogram={(b.heading || 'M').charAt(0)} className="w-full h-full" />
            </div>
            <div>
              {b.heading && <h2 className={cn('text-3xl', s.heading)}>{b.heading}</h2>}
              {b.body && <p className={cn('mt-3 leading-relaxed', s.muted)}>{b.body}</p>}
              {b.ctaLabel && b.ctaHref && (
                <Link href={b.ctaHref} className={cn('btn-outline mt-6 inline-flex', s.isDark && 'border-paper/40 text-paper hover:text-brass hover:border-brass')}>
                  {b.ctaLabel}
                </Link>
              )}
            </div>
          </div>
        </section>
      );
    }

    case 'PRODUCT_GRID': {
      const b = d as unknown as { heading: string; source: 'featured' | 'new' | 'bestsellers'; limit: number };
      const products =
        b.source === 'new' ? await getNewArrivals(b.limit)
        : b.source === 'bestsellers' ? await getBestSellers(b.limit)
        : await getFeaturedProducts(b.limit);
      // Checked here rather than relying on ProductRow's own guard, so an empty
      // row never leaves a bare coloured band behind.
      if (products.length === 0) return null;
      return (
        <section className={s.section}>
          <ProductRow title={b.heading || 'Featured'} products={products} sectionClassName={s.inner} />
        </section>
      );
    }

    case 'COLLECTION_GRID': {
      const b = d as unknown as { heading: string; limit: number };
      const collections = await getActiveCollections(b.limit);
      if (collections.length === 0) return null;
      return (
        <section className={s.section}>
          <div className={s.inner}>
            {b.heading && <h2 className={cn('text-3xl mb-6', s.align, s.heading)}>{b.heading}</h2>}
            <div className={cn('grid gap-4', s.columns)}>
              {collections.map((c) => (
                <Link key={c.id} href={`/collection/${c.slug}`} className="group block">
                  <div className={cn('aspect-[4/3] border overflow-hidden', s.border)}>
                    <ProductImage src={c.imageUrl} alt={c.name} monogram={c.name.charAt(0)} className="w-full h-full transition-transform duration-500 group-hover:scale-[1.03]" />
                  </div>
                  <p className={cn('mt-3 font-heading text-xl group-hover:text-brass transition-colors', s.heading)}>{c.name}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      );
    }

    case 'BANNER': {
      const b = d as unknown as { text: string; ctaLabel: string; ctaHref: string };
      return (
        <section className={s.section}>
          <div className={cn(s.inner, 'flex flex-wrap items-center justify-center gap-4 text-center')}>
            <p className={cn('text-sm tracking-[0.08em]', s.isDark ? 'text-paper' : 'text-ink')}>{b.text}</p>
            {b.ctaLabel && b.ctaHref && (
              <Link href={b.ctaHref} className={cn('btn-outline text-xs', s.isDark && 'border-paper/40 text-paper hover:text-brass hover:border-brass')}>
                {b.ctaLabel}
              </Link>
            )}
          </div>
        </section>
      );
    }

    case 'FAQ': {
      const b = d as unknown as { heading: string; items: { question: string; answer: string }[] };
      return (
        <section className={s.section}>
          <div className={s.inner}>
            <div className="max-w-2xl mx-auto">
              {b.heading && <h2 className={cn('text-3xl mb-6', s.align, s.heading)}>{b.heading}</h2>}
              <dl className={cn('divide-y border-y', s.divide, s.border)}>
                {b.items.map((item, i) => (
                  <div key={i} className="py-4">
                    <dt className={cn('font-heading text-lg', s.heading)}>{item.question}</dt>
                    <dd className={cn('mt-1.5 text-sm leading-relaxed', s.muted)}>{item.answer}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>
      );
    }

    case 'TRUST_ROW': {
      const b = d as unknown as { items: { title: string; subtitle: string }[] };
      return (
        <section className={cn(s.section, 'border-y', s.border)}>
          <div className={cn(s.inner, 'grid gap-6', s.columns, s.align)}>
            {b.items.map((item, i) => (
              <div key={i}>
                <p className={cn('font-heading text-lg', s.heading)}>{item.title}</p>
                {item.subtitle && <p className={cn('mt-1 text-sm', s.muted)}>{item.subtitle}</p>}
              </div>
            ))}
          </div>
        </section>
      );
    }

    case 'TESTIMONIALS': {
      const b = d as unknown as { heading: string; items: { quote: string; author: string }[] };
      return (
        <section className={s.section}>
          <div className={s.inner}>
            {b.heading && <h2 className={cn('text-3xl mb-6', s.align, s.heading)}>{b.heading}</h2>}
            <div className={cn('grid gap-5', s.columns)}>
              {b.items.map((t, i) => (
                <figure key={i} className={cn('border p-6', s.border)}>
                  <blockquote className={cn('font-heading text-lg leading-snug', s.heading)}>“{t.quote}”</blockquote>
                  {t.author && <figcaption className={cn('mt-3 text-xs tracking-[0.1em] uppercase', s.muted)}>{t.author}</figcaption>}
                </figure>
              ))}
            </div>
          </div>
        </section>
      );
    }

    case 'CTA': {
      const b = d as unknown as { heading: string; subheading: string; ctaLabel: string; ctaHref: string };
      return (
        <section className={s.section}>
          <div className={cn(s.inner, s.align)}>
            <h2 className={cn('text-3xl sm:text-4xl', s.heading)}>{b.heading}</h2>
            {b.subheading && <p className={cn('mt-3 max-w-lg', s.muted, s.style.align === 'center' && 'mx-auto')}>{b.subheading}</p>}
            <Link href={b.ctaHref} className={cn('btn-primary mt-7 inline-flex', s.isDark && 'bg-brass hover:bg-brass/90')}>
              {b.ctaLabel}
            </Link>
          </div>
        </section>
      );
    }

    default:
      return null;
  }
}
