import Link from 'next/link';
import type { CmsBlockType } from '@prisma/client';
import { cn } from '@/lib/utils/cn';
import ProductImage from '@/components/storefront/ProductImage';
import ProductRow from '@/components/storefront/ProductRow';
import { getFeaturedProducts, getNewArrivals, getBestSellers, getActiveCollections } from '@/lib/catalog';
import { parseBlockData } from '@/lib/cms/blocks';

/**
 * Renders a CMS block. Content comes from typed fields only — never raw HTML —
 * so a page can't inject markup or scripts. Invalid block data is skipped rather
 * than crashing the page.
 */
export default async function BlockRenderer({ type, data }: { type: CmsBlockType; data: unknown }) {
  const parsed = parseBlockData(type, data);
  if (!parsed.success) return null;
  const d = parsed.data as Record<string, never>;

  switch (type) {
    case 'HERO': {
      const b = d as unknown as { eyebrow: string; heading: string; subheading: string; imageUrl: string; ctaLabel: string; ctaHref: string };
      return (
        <section className="bg-paper-2">
          <div className="shell grid lg:grid-cols-2 gap-8 items-center py-14 lg:py-20">
            <div>
              {b.eyebrow && <p className="eyebrow">{b.eyebrow}</p>}
              <h1 className="mt-3 text-4xl sm:text-5xl">{b.heading}</h1>
              {b.subheading && <p className="mt-4 max-w-md text-ink-soft">{b.subheading}</p>}
              {b.ctaLabel && b.ctaHref && <Link href={b.ctaHref} className="btn-primary mt-7 inline-flex">{b.ctaLabel}</Link>}
            </div>
            <div className="aspect-[4/3] border border-line overflow-hidden">
              <ProductImage src={b.imageUrl || null} alt={b.heading} monogram={b.heading.charAt(0)} className="w-full h-full" />
            </div>
          </div>
        </section>
      );
    }

    case 'RICH_TEXT': {
      const b = d as unknown as { heading: string; body: string; align: 'left' | 'center' };
      return (
        <section className="shell py-12">
          <div className={cn('max-w-2xl', b.align === 'center' && 'mx-auto text-center')}>
            {b.heading && <h2 className="text-3xl mb-4">{b.heading}</h2>}
            {b.body.split('\n').filter(Boolean).map((para, i) => (
              <p key={i} className="text-ink-soft leading-relaxed mb-3">{para}</p>
            ))}
          </div>
        </section>
      );
    }

    case 'IMAGE_TEXT': {
      const b = d as unknown as { heading: string; body: string; imageUrl: string; imagePosition: 'left' | 'right'; ctaLabel: string; ctaHref: string };
      return (
        <section className="shell py-12 grid lg:grid-cols-2 gap-8 items-center">
          <div className={cn('aspect-[5/4] border border-line overflow-hidden', b.imagePosition === 'right' && 'lg:order-2')}>
            <ProductImage src={b.imageUrl || null} alt={b.heading || 'Image'} monogram={(b.heading || 'M').charAt(0)} className="w-full h-full" />
          </div>
          <div>
            {b.heading && <h2 className="text-3xl">{b.heading}</h2>}
            {b.body && <p className="mt-3 text-ink-soft leading-relaxed">{b.body}</p>}
            {b.ctaLabel && b.ctaHref && <Link href={b.ctaHref} className="btn-outline mt-6 inline-flex">{b.ctaLabel}</Link>}
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
      return <ProductRow title={b.heading || 'Featured'} products={products} />;
    }

    case 'COLLECTION_GRID': {
      const b = d as unknown as { heading: string; limit: number };
      const collections = await getActiveCollections(b.limit);
      if (collections.length === 0) return null;
      return (
        <section className="shell py-12">
          {b.heading && <h2 className="text-3xl mb-6">{b.heading}</h2>}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {collections.map((c) => (
              <Link key={c.id} href={`/collection/${c.slug}`} className="group block">
                <div className="aspect-[4/3] border border-line overflow-hidden">
                  <ProductImage src={c.imageUrl} alt={c.name} monogram={c.name.charAt(0)} className="w-full h-full transition-transform duration-500 group-hover:scale-[1.03]" />
                </div>
                <p className="mt-3 font-heading text-xl group-hover:text-brass transition-colors">{c.name}</p>
              </Link>
            ))}
          </div>
        </section>
      );
    }

    case 'BANNER': {
      const b = d as unknown as { text: string; ctaLabel: string; ctaHref: string; tone: 'velvet' | 'paper' };
      return (
        <section className={cn(b.tone === 'velvet' ? 'bg-velvet text-paper' : 'bg-paper-2')}>
          <div className="shell py-6 flex flex-wrap items-center justify-center gap-4 text-center">
            <p className={cn('text-sm tracking-[0.08em]', b.tone === 'velvet' ? 'text-paper' : 'text-ink')}>{b.text}</p>
            {b.ctaLabel && b.ctaHref && (
              <Link href={b.ctaHref} className={cn('btn-outline text-xs', b.tone === 'velvet' && 'border-paper/40 text-paper hover:text-brass hover:border-brass')}>
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
        <section className="shell py-12">
          <div className="max-w-2xl mx-auto">
            {b.heading && <h2 className="text-3xl mb-6 text-center">{b.heading}</h2>}
            <dl className="divide-y divide-line border-y border-line">
              {b.items.map((item, i) => (
                <div key={i} className="py-4">
                  <dt className="font-heading text-lg">{item.question}</dt>
                  <dd className="mt-1.5 text-sm text-ink-soft leading-relaxed">{item.answer}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      );
    }

    case 'TRUST_ROW': {
      const b = d as unknown as { items: { title: string; subtitle: string }[] };
      return (
        <section className="border-y border-line">
          <div className="shell py-10 grid grid-cols-2 lg:grid-cols-4 gap-6 text-center">
            {b.items.map((item, i) => (
              <div key={i}>
                <p className="font-heading text-lg">{item.title}</p>
                {item.subtitle && <p className="mt-1 text-sm text-ink-soft">{item.subtitle}</p>}
              </div>
            ))}
          </div>
        </section>
      );
    }

    case 'TESTIMONIALS': {
      const b = d as unknown as { heading: string; items: { quote: string; author: string }[] };
      return (
        <section className="shell py-12">
          {b.heading && <h2 className="text-3xl mb-6 text-center">{b.heading}</h2>}
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {b.items.map((t, i) => (
              <figure key={i} className="border border-line p-6">
                <blockquote className="font-heading text-lg leading-snug">“{t.quote}”</blockquote>
                {t.author && <figcaption className="mt-3 text-xs tracking-[0.1em] uppercase text-ink-soft">{t.author}</figcaption>}
              </figure>
            ))}
          </div>
        </section>
      );
    }

    case 'CTA': {
      const b = d as unknown as { heading: string; subheading: string; ctaLabel: string; ctaHref: string };
      return (
        <section className="bg-velvet text-paper">
          <div className="shell py-14 text-center">
            <h2 className="text-3xl sm:text-4xl text-paper">{b.heading}</h2>
            {b.subheading && <p className="mt-3 text-paper/70 max-w-lg mx-auto">{b.subheading}</p>}
            <Link href={b.ctaHref} className="btn-primary bg-brass hover:bg-brass/90 mt-7 inline-flex">{b.ctaLabel}</Link>
          </div>
        </section>
      );
    }

    default:
      return null;
  }
}
