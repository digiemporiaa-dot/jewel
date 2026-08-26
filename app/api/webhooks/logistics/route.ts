/**
 * Alias for the Shiprocket tracking webhook at a path their dashboard accepts.
 *
 * Shiprocket's webhook form rejects any URL containing "shiprocket", "sr" or
 * "kr" with "Address is not allowed", so `/api/webhooks/shiprocket` — the
 * obvious name, and the one every doc used — cannot be registered with them at
 * all. This path carries none of those three substrings, which is the whole
 * reason it is spelled "logistics" and why `tests/webhook-alias.test.ts` checks
 * that it stays that way.
 *
 * There is exactly one handler. It lives in the shiprocket route and is
 * re-exported here rather than copied, so a fix to signature checking,
 * idempotency or status mapping cannot land on one path and miss the other.
 * The original path keeps working: anything already pointed at it, including a
 * dashboard entry made before their validator tightened, is unaffected.
 */
export { POST } from '../shiprocket/route';

// Declared here rather than re-exported: Next reads route segment config by
// static analysis of the segment's own file and does not follow re-exports.
export const dynamic = 'force-dynamic';
