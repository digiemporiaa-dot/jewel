import { getStoreSettings } from '@/lib/store';
import { WhatsAppIcon } from '@/components/icons';

/** Site-wide floating WhatsApp enquiry button (brief §26). Number from settings. */
export default async function WhatsAppFab() {
  const store = await getStoreSettings();
  if (!store.whatsappNumber) return null;
  const digits = store.whatsappNumber.replace(/[^0-9]/g, '');
  if (!digits) return null;
  const href = `https://wa.me/${digits}?text=${encodeURIComponent(`Hi ${store.brandName}, I have a question.`)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label="Chat on WhatsApp"
      className="fixed z-30 right-4 bottom-20 lg:bottom-6 grid place-items-center h-12 w-12 rounded-full bg-[#25D366] text-white shadow-lg hover:scale-105 transition-transform"
    >
      <WhatsAppIcon width={26} height={26} />
    </a>
  );
}
