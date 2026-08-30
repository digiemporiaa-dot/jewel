import 'server-only';
import { JWT } from 'google-auth-library';
import { chunk, BATCH_SIZE, type BatchResult, type MerchantProduct, type MerchantProvider } from '@/lib/merchant/provider';
import { toGoogleProduct, googleProductId, type GoogleProduct } from '@/lib/merchant/mapping';

/**
 * Google Content API for Shopping, v2.1.
 *
 * Called right after the nightly reprice, so a new gold rate is in the Shopping
 * listing within seconds rather than whenever Google next crawls the feed.
 *
 * Nothing here throws. This runs inside the pricing cron, and an integration
 * that can fail the job it is attached to would mean an unreachable Merchant
 * Center stops the catalogue being repriced — trading the thing that matters for
 * the thing that is nice to have.
 */

const API = 'https://shoppingcontent.googleapis.com/content/v2.1';
const SCOPE = 'https://www.googleapis.com/auth/content';
/** One retry, then give up. A cron that runs again tomorrow is the real retry. */
const RETRY_AFTER_MS = 2000;

type ServiceAccount = { client_email: string; private_key: string };

/**
 * Read the service-account key out of the environment.
 *
 * Returns null rather than throwing: an unparseable key is a configuration
 * mistake, and the correct response to one is to run without the integration,
 * not to take the shop down.
 *
 * The `\n` handling is the part that bites. A private key is multi-line, and
 * every way of getting one into an environment variable mangles it differently
 * — Coolify's Literal setting keeps it intact, but a key pasted through a shell
 * or a `.env` arrives with the newlines escaped, and `createSign` then fails
 * with an error that says nothing about newlines.
 */
export function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  if (!raw?.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { client_email: email, private_key: key } = parsed as Record<string, unknown>;
    if (typeof email !== 'string' || typeof key !== 'string' || !email || !key) return null;
    return { client_email: email, private_key: key.replace(/\\n/g, '\n') };
  } catch {
    return null;
  }
}

export class GoogleMerchantProvider implements MerchantProvider {
  readonly name = 'google';

  private client: JWT | null = null;

  private get merchantId(): string {
    return (process.env.GOOGLE_MERCHANT_ID ?? '').trim();
  }

  private get account(): ServiceAccount | null {
    return parseServiceAccount(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  }

  get dev(): boolean {
    return !this.merchantId || this.account === null;
  }

  private auth(): JWT | null {
    if (this.client) return this.client;
    const account = this.account;
    if (!account) return null;
    this.client = new JWT({ email: account.client_email, key: account.private_key, scopes: [SCOPE] });
    return this.client;
  }

  /**
   * One request, with a single retry on the two statuses worth retrying.
   *
   * 429 is Google asking us to slow down and 503 is Google being briefly
   * unavailable; both succeed on a second attempt often enough to be worth one.
   * A 400 will fail identically forever — retrying it just doubles the log.
   */
  private async request(path: string, init: RequestInit, attempt = 0): Promise<Response | null> {
    // `path` is everything after `/content/v2.1`, including the merchant id
    // where the endpoint is scoped by one. It is not prefixed here, because
    // `products.custombatch` is *not* merchant-scoped: it lives at
    // `/products/batch` and carries a merchantId on every entry, so one batch
    // can span several accounts. Prefixing it produced
    // `/content/v2.1/{id}/products/batch`, which is a 404 — and since the batch
    // is the call the reprice cron makes, that was the whole feature failing.
    void 0;
    const client = this.auth();
    if (!client) return null;
    try {
      const { token } = await client.getAccessToken();
      if (!token) {
        console.error('[merchant:google] no access token — check the service account key');
        return null;
      }
      const res = await fetch(`${API}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      });
      if ((res.status === 429 || res.status === 503) && attempt === 0) {
        await new Promise((r) => setTimeout(r, RETRY_AFTER_MS));
        return this.request(path, init, 1);
      }
      return res;
    } catch (e) {
      console.error('[merchant:google] request failed', path, e instanceof Error ? e.message : e);
      return null;
    }
  }

  async upsertProduct(product: MerchantProduct): Promise<void> {
    if (this.dev) return;
    const res = await this.request(`/${this.merchantId}/products`, { method: 'POST', body: JSON.stringify(toGoogleProduct(product)) });
    if (res && !res.ok) {
      console.error('[merchant:google] upsert rejected', product.offerId, res.status, (await res.text()).slice(0, 500));
    }
  }

  async deleteProduct(offerId: string): Promise<void> {
    if (this.dev) return;
    // The product id Google keys on, not our SKU alone: channel, language,
    // country and offer id, joined by colons.
    const id = googleProductId(offerId);
    const res = await this.request(`/${this.merchantId}/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
    // 404 is the desired end state reached by another route, not a failure.
    if (res && !res.ok && res.status !== 404) {
      console.error('[merchant:google] delete rejected', offerId, res.status);
    }
  }

  async batchUpsert(products: MerchantProduct[]): Promise<BatchResult> {
    if (this.dev) {
      return { succeeded: 0, failed: [], skipped: true };
    }

    let succeeded = 0;
    const failed: BatchResult['failed'] = [];

    for (const group of chunk(products, BATCH_SIZE)) {
      const entries = group.map((product, i) => ({
        batchId: i,
        merchantId: this.merchantId,
        method: 'insert' as const,
        product: toGoogleProduct(product),
      }));

      // Top level, deliberately — see the note in `request`.
      const res = await this.request('/products/batch', { method: 'POST', body: JSON.stringify({ entries }) });
      if (!res) {
        // The whole group never left. Counted as failed so the caller's numbers
        // add up to what was asked for — a silent shortfall reads as success.
        for (const p of group) failed.push({ offerId: p.offerId, error: 'request failed' });
        continue;
      }
      if (!res.ok) {
        const body = (await res.text()).slice(0, 500);
        console.error('[merchant:google] batch rejected', res.status, body);
        for (const p of group) failed.push({ offerId: p.offerId, error: `HTTP ${res.status}` });
        continue;
      }

      const { succeeded: ok, failed: bad } = readBatchResponse(await res.json().catch(() => null), group);
      succeeded += ok;
      failed.push(...bad);
    }

    return { succeeded, failed, skipped: false };
  }
}

/**
 * Read a `products.custombatch` reply.
 *
 * A 200 does not mean every item was accepted: Content API returns per-entry
 * results, and a batch of a hundred can come back 200 with ninety-nine errors
 * in it. Counting the HTTP status as the outcome is how a sync reports success
 * while the catalogue quietly stops updating.
 *
 * Exported and shape-tolerant so the parsing can be tested without a network.
 */
export function readBatchResponse(
  body: unknown,
  group: readonly MerchantProduct[]
): { succeeded: number; failed: BatchResult['failed'] } {
  const entries = (body as { entries?: unknown })?.entries;
  if (!Array.isArray(entries)) {
    // A 200 we cannot read is not a success we can claim.
    return { succeeded: 0, failed: group.map((p) => ({ offerId: p.offerId, error: 'unreadable batch response' })) };
  }

  let succeeded = 0;
  const failed: BatchResult['failed'] = [];
  for (const entry of entries) {
    const row = (entry ?? {}) as { batchId?: unknown; errors?: { errors?: Array<{ message?: unknown }> } };
    const index = typeof row.batchId === 'number' ? row.batchId : -1;
    const offerId = group[index]?.offerId ?? 'unknown';
    const problems = row.errors?.errors;
    if (Array.isArray(problems) && problems.length > 0) {
      const message = problems.map((e) => (typeof e?.message === 'string' ? e.message : 'rejected')).join('; ');
      failed.push({ offerId, error: message });
    } else {
      succeeded += 1;
    }
  }
  return { succeeded, failed };
}

export type { GoogleProduct };
