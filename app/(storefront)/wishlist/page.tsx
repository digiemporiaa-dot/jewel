import type { Metadata } from 'next';
import Link from 'next/link';
import { getSessionToken } from '@/lib/session';
import { getWishlist } from '@/lib/wishlist';
import WishlistCard from './WishlistCard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Wishlist',
  robots: { index: false, follow: false },
};

export default async function WishlistPage() {
  const token = await getSessionToken();
  const items = await getWishlist(token);

  return (
    <div className="shell py-8 sm:py-12">
      <header className="mb-8">
        <p className="eyebrow">Saved</p>
        <h1 className="mt-2 text-3xl sm:text-4xl">Your Wishlist</h1>
      </header>

      {items.length === 0 ? (
        <div className="border border-line bg-paper py-16 text-center">
          <p className="font-heading text-xl">Nothing saved yet</p>
          <p className="mt-2 text-ink-soft text-sm">Tap the heart on any piece to save it here.</p>
          <Link href="/c/new-arrivals" className="btn-primary mt-6 inline-flex">Browse jewellery</Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8">
          {items.map((p) => <WishlistCard key={p.id} product={p} />)}
        </div>
      )}
    </div>
  );
}
