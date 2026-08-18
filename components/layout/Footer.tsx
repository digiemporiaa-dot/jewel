import Link from 'next/link';
import { getStoreSettings, getSocialLinks } from '@/lib/store';
import { InstagramIcon, WhatsAppIcon } from '@/components/icons';

const SHOP = [
  { label: 'New Arrivals', href: '/c/new-arrivals' },
  { label: 'Gold', href: '/c/gold' },
  { label: 'Diamond', href: '/c/diamond' },
  { label: 'Silver', href: '/c/silver' },
  { label: 'Collections', href: '/collections' },
];

const HELP = [
  { label: 'Track Order', href: '/my-account/orders' },
  { label: 'Book Appointment', href: '/appointments' },
  { label: 'Shipping & Returns', href: '/pages/shipping-returns' },
  { label: 'Jewellery Care', href: '/pages/jewellery-care' },
  { label: 'Contact Us', href: '/pages/contact' },
];

const ABOUT = [
  { label: 'Our Story', href: '/pages/about' },
  { label: 'BIS Hallmark', href: '/pages/hallmark' },
  { label: 'Certifications', href: '/pages/certifications' },
  { label: 'Blog', href: '/blog' },
];

export default async function Footer() {
  const store = await getStoreSettings();
  const social = getSocialLinks(store);

  return (
    <footer className="mt-20 bg-velvet text-paper">
      <div className="shell py-14">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          {/* Brand */}
          <div>
            <p className="font-heading text-2xl tracking-wide">{store.brandName}</p>
            <p className="mt-3 text-sm text-paper/70 max-w-xs">{store.tagline}</p>
            {store.addressLine && (
              <p className="mt-4 text-sm text-paper/60 leading-relaxed">
                {store.addressLine}
                {store.city ? `, ${store.city}` : ''}
                {store.state ? `, ${store.state}` : ''}
                {store.pincode ? ` ${store.pincode}` : ''}
              </p>
            )}
            <div className="mt-5 flex items-center gap-4">
              {social.instagram && (
                <a href={social.instagram} aria-label="Instagram" className="text-paper/80 hover:text-paper" target="_blank" rel="noreferrer">
                  <InstagramIcon />
                </a>
              )}
              {store.whatsappNumber && (
                <a
                  href={`https://wa.me/${store.whatsappNumber.replace(/[^0-9]/g, '')}`}
                  aria-label="WhatsApp"
                  className="text-paper/80 hover:text-paper"
                  target="_blank"
                  rel="noreferrer"
                >
                  <WhatsAppIcon />
                </a>
              )}
            </div>
          </div>

          <FooterCol title="Shop" links={SHOP} />
          <FooterCol title="Help" links={HELP} />
          <FooterCol title="About" links={ABOUT} />
        </div>

        {/* Newsletter */}
        <div className="mt-12 border-t border-paper/15 pt-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="font-heading text-lg">Join the Maya circle</p>
            <p className="text-sm text-paper/60">New collections, private previews and metal-rate alerts.</p>
          </div>
          <form className="flex w-full max-w-sm gap-2">
            <input
              type="email"
              required
              placeholder="Your email"
              aria-label="Email"
              className="flex-1 bg-transparent border-b border-paper/30 focus:border-brass py-2 text-sm outline-none placeholder:text-paper/50"
            />
            <button type="submit" className="btn-primary bg-brass hover:bg-brass/90">
              Subscribe
            </button>
          </form>
        </div>
      </div>

      <div className="border-t border-paper/15">
        <div className="shell py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-paper/55">
          <p>
            © {new Date().getFullYear()} {store.brandName}
            {store.gstin ? ` · GSTIN ${store.gstin}` : ''}. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            <Link href="/pages/privacy" className="hover:text-paper">Privacy</Link>
            <Link href="/pages/terms" className="hover:text-paper">Terms</Link>
            {store.phone && <span>{store.phone}</span>}
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div>
      <p className="eyebrow text-paper/70">{title}</p>
      <ul className="mt-4 space-y-2.5">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="text-sm text-paper/75 hover:text-paper">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
