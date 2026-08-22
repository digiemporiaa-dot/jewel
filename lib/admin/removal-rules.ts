/**
 * The rules of removal, with no database behind them.
 *
 * Pulled out of `lib/admin/soft-delete.ts` so they can be tested directly — that
 * file is `server-only`, and these two decisions are exactly the ones worth
 * pinning down: what a scrubbed customer's fields become, and which orders may
 * be filed away.
 */

/**
 * What an erased customer's fields become.
 *
 * `phone` is unique and not nullable, so it cannot simply be emptied — it is
 * replaced with a value that is unmistakably not a phone number and cannot
 * collide with another erased customer's. `email` is nullable, and goes.
 */
export function anonymisedFields(customerId: string) {
  return {
    name: 'Removed at request',
    phone: `removed-${customerId}`,
    email: null,
    gender: null,
    dob: null,
    anniversary: null,
    marketingOptIn: false,
    phoneVerified: false,
  };
}

/**
 * Orders that are finished, one way or another, and may be filed away.
 *
 * Archiving is about clearing the working list, so an order still in flight is
 * not eligible: hiding a live order from the people who have to ship it is not
 * a feature. Cancelling is what an order that is not going ahead needs.
 */
const ARCHIVABLE = ['DELIVERED', 'CANCELLED', 'REFUNDED', 'RTO'] as const;

export function isArchivable(status: string): boolean {
  return (ARCHIVABLE as readonly string[]).includes(status);
}
