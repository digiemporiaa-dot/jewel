import Link from 'next/link';
import { getStoreSettings } from '@/lib/store';
import { getNavigation } from '@/lib/navigation';
import { getSessionToken } from '@/lib/session';
import { getCartCount } from '@/lib/cart';
import { getWishlistCount } from '@/lib/wishlist';
import BrandMark from '@/components/layout/BrandMark';
import RateTicker from '@/components/layout/RateTicker';
import MobileMenu from '@/components/layout/MobileMenu';
import { SearchIcon, HeartIcon, BagIcon, UserIcon } from '@/components/icons';

function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -top-1.5 -right-1.5 grid place-items-center min-w-[16px] h-4 px-1 text-[0.6rem] leading-none bg-brass text-paper rounded-full">
      {count > 99 ? '99+' : count}
    </span>
  );
}

export default async function Header() {
  const token = await getSessionToken();
  const [store, nav, cartCount, wishCount] = await Promise.all([
    getStoreSettings(),
    getNavigation(),
    getCartCount(token),
    getWishlistCount(token),
  ]);

  return (
    <header className="relative z-40 bg-paper">
      {/* Top bar — the rate strip owns its own full-width background and colour
          now, because both are an admin choice. The announcement that used to
          sit beside it is the ticker's optional message, so the two cannot
          disagree about the colour they are printed on. */}
      <RateTicker />

      {/* Main bar */}
      <div className="hairline">
        <div className="shell">
          {/* Mobile row */}
          <div className="flex lg:hidden items-center justify-between h-16">
            <MobileMenu nav={nav} brandName={store.brandName} />
            {/* Still a link to "/", logo or not. */}
            <Link href="/" className="min-w-0">
              <BrandMark
                brandName={store.brandName}
                logoUrl={store.logoUrl}
                // 28px against a 64px bar: the optical size of the 1.25rem
                // wordmark it replaces, with room left either side.
                height={28}
                wordmarkClassName="font-heading text-xl tracking-wide"
              />
            </Link>
            <div className="flex items-center gap-3">
              <Link href="/search" aria-label="Search" className="p-1.5">
                <SearchIcon />
              </Link>
              <Link href="/wishlist" aria-label="Wishlist" className="relative p-1.5">
                <HeartIcon />
                <CountBadge count={wishCount} />
              </Link>
              <Link href="/cart" aria-label="Cart" className="relative p-1.5">
                <BagIcon />
                <CountBadge count={cartCount} />
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

            <Link href="/" className="justify-self-center text-center min-w-0">
              <BrandMark
                brandName={store.brandName}
                logoUrl={store.logoUrl}
                // 40px against an 80px bar, matching the 1.7rem wordmark.
                height={40}
                className="justify-center"
                wordmarkClassName="block font-heading text-[1.7rem] leading-none tracking-wide"
              />
              {/* The tagline stays under either mark. A logo replaces the
                  wordmark, not the sentence next to it. */}
              <span className="block eyebrow mt-1">{store.tagline}</span>
            </Link>

            <div className="justify-self-end flex items-center gap-6 text-sm">
              <Link href="/my-account" className="flex items-center gap-1.5 hover:text-brass">
                <UserIcon /> <span>Account</span>
              </Link>
              <Link href="/wishlist" className="relative flex items-center gap-1.5 hover:text-brass" aria-label="Wishlist">
                <HeartIcon />
                <CountBadge count={wishCount} />
              </Link>
              <Link href="/cart" className="relative flex items-center gap-1.5 hover:text-brass" aria-label="Cart">
                <BagIcon />
                <CountBadge count={cartCount} />
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Desktop nav */}
      <nav className="hidden lg:block hairline">
        <div className="shell">
          {/* Wraps rather than clipping.
              `justify-center` on a non-wrapping row centres content that is too
              wide, so the overflow is cut off at *both* ends — "New Arrivals"
              rendered as "vals" and "Collections" as "Collecti", with no way to
              scroll to either. It was already 16px over at 1280px with thirteen
              categories, and Montserrat's wider letterforms doubled that. A shop
              that adds a category should get a second row, not a truncated nav. */}
          <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 min-h-12 py-2">
            {nav.map((item) => (
              <li key={item.href} className="relative group">
                <Link
                  href={item.href}
                  className="block py-3 text-[0.78rem] tracking-[0.14em] uppercase text-ink-soft hover:text-ink transition-colors"
                >
                  {item.label}
                </Link>
                {item.children && item.children.length > 0 && (
                  // One level of dropdown, opened by hover or keyboard focus —
                  // `focus-within` keeps it reachable without a mouse, and no
                  // client component is needed for it.
                  <ul className="absolute left-1/2 -translate-x-1/2 top-full z-50 min-w-[190px] border border-line bg-paper py-1.5 shadow-sm opacity-0 invisible transition-opacity group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible">
                    {item.children.map((child) => (
                      <li key={child.href}>
                        <Link
                          href={child.href}
                          className="block px-4 py-2 text-[0.8rem] text-ink-soft hover:text-brass whitespace-nowrap"
                        >
                          {child.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </header>
  );
}
