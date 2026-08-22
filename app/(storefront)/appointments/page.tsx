import type { Metadata } from 'next';
import { getStoreSettings } from '@/lib/store';
import { getInterestProducts } from './actions';
import AppointmentForm from './AppointmentForm';
import { buildMetadata } from '@/lib/seo/metadata';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    path: '/appointments',
    fallbackTitle: 'Book an Appointment',
    fallbackDescription: 'Book a showroom visit or a video consultation with our jewellery consultants.',
  });
}

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  const sp = await searchParams;
  const [store, products] = await Promise.all([getStoreSettings(), getInterestProducts()]);

  return (
    <div className="shell py-10 sm:py-14">
      <div className="max-w-2xl mx-auto">
        <header className="text-center mb-8">
          <p className="eyebrow">Personal consultation</p>
          <h1 className="mt-2 text-3xl sm:text-4xl">Book an appointment</h1>
          <p className="mt-3 text-ink-soft">
            Meet our consultants at the showroom, or join a video call from anywhere.
            We&apos;ll set aside the pieces you&apos;d like to see.
          </p>
        </header>

        <AppointmentForm products={products} defaultProductId={sp.product} />

        <div className="mt-8 grid sm:grid-cols-3 gap-4 text-center text-sm">
          {[
            ['Private viewing', 'Unhurried, one-to-one time with a consultant'],
            ['Expert guidance', 'Hallmarking, certification and craft explained'],
            ['No obligation', 'Browse and ask — buy only when you are ready'],
          ].map(([t, s]) => (
            <div key={t} className="border border-line p-4">
              <p className="font-heading text-base">{t}</p>
              <p className="mt-1 text-xs text-ink-soft">{s}</p>
            </div>
          ))}
        </div>

        {(store.addressLine || store.phone) && (
          <p className="mt-6 text-center text-sm text-ink-soft">
            {store.addressLine ? `${store.addressLine}, ${store.city ?? ''} ${store.pincode ?? ''}` : ''}
            {store.phone ? ` · ${store.phone}` : ''}
          </p>
        )}
      </div>
    </div>
  );
}
