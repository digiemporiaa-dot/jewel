'use client';

import { useEffect, useRef } from 'react';
import { trackEcommerce, trackAdsConversion } from '@/lib/marketing/events';
import type { PurchasePayload } from '@/lib/marketing/purchase';

/**
 * Emits the browser-side `purchase` event for an order.
 *
 * Rendered only when the server won the claim in `claimPurchaseTracking`, so
 * this component appearing at all *is* the once-per-order guarantee. The ref
 * guard is a second belt for React's development double-invoke of effects.
 *
 * The order number is passed to Meta as the event ID, matching what the
 * server-side CAPI call sends, so the pair is deduplicated into one conversion.
 */
export default function PurchaseTracker({
  payload,
  googleAdsId,
  googleAdsLabel,
}: {
  payload: PurchasePayload;
  googleAdsId: string | null;
  googleAdsLabel: string | null;
}) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    trackEcommerce('purchase', payload, payload.transaction_id);

    if (googleAdsId && googleAdsLabel) {
      trackAdsConversion(googleAdsId, googleAdsLabel, {
        value: payload.value,
        currency: payload.currency,
        transaction_id: payload.transaction_id,
      });
    }
  }, [payload, googleAdsId, googleAdsLabel]);

  return null;
}
