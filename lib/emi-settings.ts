import 'server-only';
import { getStoreSettings } from '@/lib/store';
import { lowestEmi, allEmiOptions, parseTenures, type EmiOption } from '@/lib/emi';

/**
 * Resolve the EMI messaging for an amount, from live settings.
 *
 * One place so the product page, the cart and the checkout cannot drift apart
 * and quote different monthly figures for the same money.
 */
export async function emiFor(amount: string | number | null | undefined): Promise<{
  best: EmiOption | null;
  options: EmiOption[];
}> {
  if (amount === null || amount === undefined || Number(amount) <= 0) {
    return { best: null, options: [] };
  }

  const store = await getStoreSettings();
  const params = {
    amount: String(amount),
    enabled: store.emiEnabled,
    minAmount: store.emiMinAmount ? store.emiMinAmount.toString() : null,
    tenures: parseTenures(store.emiTenures),
  };

  return { best: lowestEmi(params), options: allEmiOptions(params) };
}
