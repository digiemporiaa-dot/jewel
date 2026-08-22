'use client';

import { WhatsAppIcon } from '@/components/icons';
import { trackLead } from '@/lib/marketing/events';

/**
 * A WhatsApp click-to-chat link that tells the shop it was clicked.
 *
 * The enquiry is logged with `navigator.sendBeacon`, which is the whole point:
 * a beacon is queued by the browser and delivered independently of the page, so
 * the shopper reaches WhatsApp at exactly the speed they would have without it.
 * An `await` before `window.open` — or a fetch the unload cancels — would either
 * add a visible delay or lose the enquiry, and the delay is the worse of the
 * two: nobody waits on a chat button.
 *
 * If the beacon fails, is blocked, or the browser does not support it, nothing
 * happens except that the shop does not learn about this one click. The link
 * itself is a plain anchor and works with JavaScript switched off entirely.
 */
export default function WhatsAppLink({
  href, productId = null, className, children, ariaLabel,
}: {
  href: string;
  productId?: string | null;
  className?: string;
  children?: React.ReactNode;
  ariaLabel?: string;
}) {
  function logEnquiry(): void {
    try {
      const body = JSON.stringify({ productId });
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon?.('/api/enquiry', blob);
    } catch {
      // Never let analytics break the thing being measured.
    }
    // Marketing tags get the same signal. Each pixel global only exists when
    // that tag is actually loaded, which is what consent gates.
    trackLead({ productId });
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={ariaLabel}
      className={className}
      onClick={logEnquiry}
    >
      {children ?? <WhatsAppIcon width={26} height={26} />}
    </a>
  );
}
