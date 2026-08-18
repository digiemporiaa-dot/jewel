import Link from 'next/link';
import { getStoreSettings } from '@/lib/store';
import { getNavigation } from '@/lib/navigation';
import RateTicker from '@/components/layout/RateTicker';
import MobileMenu from '@/components/layout/MobileMenu';
import { SearchIcon, HeartIcon, BagIcon, UserIcon } from '@/components/icons';

export default async function Header() {
  const [store, nav] = await Promise.all([getStoreSettings(), getNavigation()]);

  return (
    <header className="relative z-40 bg-paper">
      {/* Top bar — rate ticker + announcement */}
      <div className="bg-velvet text-paper">
        <div className="shell flex h-9 items-center justify-between gap-4">
          <RateTicker />
          <p className="hidden sm:block text-[0.7rem] tracking-[0.14em] uppercase text-paper/70">
            BIS Hallmarked · Certified Diamonds · Pan-India Delivery
          </p>
        </div>
      </div>

      {/* Main bar */}
      <div className="hairline">
        <div className="shell">
          {/* Mobile row */}
          <div className="flex lg:hidden items-center justify-between h-16">
            <MobileMenu nav={nav} brandName={store.brandName} />
            <Link href="/" className="font-heading text-xl tracking-wide">
              {store.brandName}
            </Link>
            <div className="flex items-center gap-3">
              <Link href="/wishlist" aria-label="Wishlist" className="p-1.5">
                <HeartIcon />
              </Link>
              <Link href="/cart" aria-label="Cart" className="p-1.5">
                <BagIcon />
              </Link>
            </div>
          </div>

          {/* Desktop row */}
          <div className="hidden lg:grid grid-cols-[1fr_auto_1fr] items-center h-20">
            <form action="/search" className="flex items-center gap-2 max-w-xs">
              <SearchIcon className="text-ink-soft" />
              <input
                name="q"
                placeholder="Search jewellery, SKU…"
                aria-label="Search"
                className="w-full bg-transparent border-b border-line focus:border-brass py-1.5 text-sm outline-none placeholder:text-ink-soft/70"
              />
            </form>

            <Link href="/" className="justify-self-center text-center">
              <span className="block font-heading text-[1.7rem] leading-none tracking-wide">
                {store.brandName}
              </span>
              <span className="block eyebrow mt-1">{store.tagline}</span>
            </Link>

            <div className="justify-self-end flex items-center gap-6 text-sm">
              <Link href="/my-account" className="flex items-center gap-1.5 hover:text-brass">
                <UserIcon /> <span>Account</span>
              </Link>
              <Link href="/wishlist" className="flex items-center gap-1.5 hover:text-brass" aria-label="Wishlist">
                <HeartIcon />
              </Link>
              <Link href="/cart" className="flex items-center gap-1.5 hover:text-brass" aria-label="Cart">
                <BagIcon />
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Desktop nav */}
      <nav className="hidden lg:block hairline">
        <div className="shell">
          <ul className="flex items-center justify-center gap-7 h-12">
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="text-[0.78rem] tracking-[0.14em] uppercase text-ink-soft hover:text-ink transition-colors"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </header>
  );
}
