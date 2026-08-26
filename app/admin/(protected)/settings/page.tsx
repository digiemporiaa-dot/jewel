import { requirePermission } from '@/lib/auth/guard';
import { getStoreSettings, getSocialLinks } from '@/lib/store';
import PageHeader from '@/components/admin/PageHeader';
import SettingsForm from './SettingsForm';
import { parseTenures } from '@/lib/emi';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  await requirePermission('settings.manage');
  const store = await getStoreSettings();
  const social = getSocialLinks(store);

  return (
    <div>
      <PageHeader
        title="Store Settings"
        description="Every store-specific value lives here — nothing brand-specific is hardcoded."
      />
      <SettingsForm
        defaults={{
          brandName: store.brandName,
          tagline: store.tagline,
          logoUrl: store.logoUrl ?? '',
          logoUrlDark: store.logoUrlDark ?? '',
          faviconUrl: store.faviconUrl ?? '',
          phone: store.phone ?? '',
          whatsappNumber: store.whatsappNumber ?? '',
          email: store.email ?? '',
          supportEmail: store.supportEmail ?? '',
          addressLine: store.addressLine ?? '',
          city: store.city ?? '',
          state: store.state ?? '',
          pincode: store.pincode ?? '',
          gstin: store.gstin ?? '',
          emiEnabled: store.emiEnabled,
          emiMinAmount: store.emiMinAmount ? store.emiMinAmount.toString() : '',
          emiTenures: parseTenures(store.emiTenures).map((t) => `${t.months}@${t.annualRatePercent}`).join('\n'),
          sellerStateCode: store.sellerStateCode ?? '',
          gstPercentDefault: store.gstPercentDefault.toString(),
          freeShippingAbove: store.freeShippingAbove?.toString() ?? '',
          flatShippingFee: store.flatShippingFee.toString(),
          codMaxOrderValue: store.codMaxOrderValue?.toString() ?? '',
          codTokenAmount: store.codTokenAmount.toString(),
          verificationCallAbove: store.verificationCallAbove?.toString() ?? '',
          panThreshold: store.panThreshold?.toString() ?? '',
          rateLockMinutes: store.rateLockMinutes,
          instagram: social.instagram ?? '',
          facebook: social.facebook ?? '',
          youtube: social.youtube ?? '',
          returnPolicy: store.returnPolicy ?? '',
          footerNote: store.footerNote ?? '',
        }}
      />
    </div>
  );
}
