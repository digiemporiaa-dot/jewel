import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { can } from '@/lib/auth/rbac';
import { writeAudit } from '@/lib/audit';
import { syncCatalogueToMerchant } from '@/lib/merchant/sync';
import { getMerchantProvider } from '@/lib/merchant';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Longer than the cron's, because nobody is waiting on a repricing job here —
// somebody pressed a button and is watching for the answer.
export const maxDuration = 120;

/**
 * Push the whole catalogue to Google Shopping, now.
 *
 * The nightly reprice already does this. This is for the moment after a bulk
 * import or a batch of edits, when waiting until tomorrow means a day of
 * Shopping listings that do not match the shop.
 */
export async function POST() {
  // `auth()` and an explicit status, not `assertPermission`.
  //
  // The guard throws, which a server action turns into a handled error and a
  // route handler turns into a 500 — the wrong code, and a stack trace in the
  // log for something that is simply "you are not signed in". Verified by
  // calling this endpoint with no session and getting a 500 before the change.
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  }
  if (!can(session.user.role, 'products.manage')) {
    return NextResponse.json({ error: 'You do not have access to products.' }, { status: 403 });
  }

  const provider = getMerchantProvider();
  if (provider.dev) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'No Merchant Center is configured. Set GOOGLE_MERCHANT_ID and GOOGLE_SERVICE_ACCOUNT_JSON, then redeploy. ' +
          'In Coolify the key must be pasted as a Literal — it contains characters a shell would otherwise expand.',
      },
      { status: 400 }
    );
  }

  // No timeout: the caller is a person who asked for this and can wait.
  const result = await syncCatalogueToMerchant(Number.MAX_SAFE_INTEGER);

  await writeAudit({
    userId: session.user.id,
    action: 'MERCHANT_SYNC',
    entity: 'Product',
    entityId: 'catalogue',
    after: result,
  });

  return NextResponse.json({ ok: true, result });
}
