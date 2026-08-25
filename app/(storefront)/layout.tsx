import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import WhatsAppFab from '@/components/storefront/WhatsAppFab';
import SpinWheel from '@/components/spin/SpinWheel';

export default function StorefrontLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main" className="flex-1">{children}</main>
      <Footer />
      <WhatsAppFab />
      {/* Mounted site-wide, but it decides for itself whether to appear: never
          on the cart, the checkout or an order page, never on first paint, and
          never again once dismissed or spun. See lib/spin/display.ts. */}
      <SpinWheel />
    </div>
  );
}
