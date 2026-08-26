'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import ImageUploadField from '@/components/admin/ImageUploadField';
import LogoPreview from '@/components/admin/LogoPreview';
import { updateSettingsAction } from './actions';

export type SettingsDefaults = Record<string, string | number | boolean | undefined>;

export default function SettingsForm({ defaults }: { defaults: SettingsDefaults }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null); setError(null);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = await updateSettingsAction(fd);
      if (res.ok) { setMsg('Settings saved'); router.refresh(); }
      else setError(res.error ?? 'Failed');
    });
  }

  const v = (k: string) => String(defaults[k] ?? '');

  // Controlled, so the preview below updates as the operator uploads or pastes.
  // The fields still post their own values — ImageUploadField renders a real
  // input either way — so nothing about saving changes.
  const [logoUrl, setLogoUrl] = useState(v('logoUrl'));
  const [logoUrlDark, setLogoUrlDark] = useState(v('logoUrlDark'));

  return (
    <form onSubmit={submit} className="space-y-6 text-sm">
      <Section title="Brand">
        <Grid>
          <F label="Brand name"><input name="brandName" defaultValue={v('brandName')} required className="s-inp" /></F>
          <F label="Tagline"><input name="tagline" defaultValue={v('tagline')} className="s-inp" /></F>
        </Grid>
        <Grid>
          <ImageUploadField
            name="logoUrl"
            label="Logo"
            prefix="brand"
            value={logoUrl}
            onChange={setLogoUrl}
            hint="Shown in the header and the footer, and used as the shop's logo in structured data. Sized by height, so any width works."
            altSourceNote="Described by the brand name."
          />
          <ImageUploadField
            name="logoUrlDark"
            label="Logo for dark backgrounds"
            prefix="brand"
            value={logoUrlDark}
            onChange={setLogoUrlDark}
            hint="Optional. Used on the footer, which is deep green. Leave empty to use the main logo there too."
            altSourceNote="Described by the brand name."
          />
        </Grid>
        <Grid>
          {/* Both previews sit on a light and a dark swatch, because the footer
              is dark and a logo that disappears there is otherwise found in
              production. */}
          <LogoPreview url={logoUrl} label="Logo" />
          <LogoPreview url={logoUrlDark} label="Dark-background logo" />
        </Grid>
        <Grid>
          <ImageUploadField
            name="faviconUrl"
            label="Favicon"
            prefix="brand"
            defaultValue={v('faviconUrl')}
            hint="The small icon in a browser tab. A square PNG works everywhere. Left empty, the built-in icon is kept."
            altSourceNote="Browsers do not read alt text for a favicon."
          />
        </Grid>
      </Section>

      <Section title="Contact">
        <Grid>
          <F label="Phone"><input name="phone" defaultValue={v('phone')} className="s-inp" /></F>
          <F label="WhatsApp number"><input name="whatsappNumber" defaultValue={v('whatsappNumber')} className="s-inp" /></F>
          <F label="Email"><input name="email" defaultValue={v('email')} className="s-inp" /></F>
          <F label="Support email"><input name="supportEmail" defaultValue={v('supportEmail')} className="s-inp" /></F>
        </Grid>
      </Section>

      <Section title="Address & tax">
        <Grid>
          <F label="Address"><input name="addressLine" defaultValue={v('addressLine')} className="s-inp" /></F>
          <F label="City"><input name="city" defaultValue={v('city')} className="s-inp" /></F>
          <F label="State"><input name="state" defaultValue={v('state')} className="s-inp" /></F>
          <F label="Pincode"><input name="pincode" defaultValue={v('pincode')} className="s-inp" /></F>
          <F label="GSTIN"><input name="gstin" defaultValue={v('gstin')} className="s-inp" /></F>
          <F label="EMI messaging">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="emiEnabled" defaultChecked={Boolean(defaults.emiEnabled)} />
              <span>Show &ldquo;EMI from ₹X/month&rdquo; on product pages and the bag</span>
            </label>
            <span className="mt-1 block text-xs text-ink-soft">
              The figure is indicative — the bank sets the real tenure and rate at checkout, and the
              storefront says so wherever it appears.
            </span>
          </F>
          <F label="EMI minimum order (₹)">
            <input name="emiMinAmount" defaultValue={v('emiMinAmount')} inputMode="decimal" placeholder="Leave blank for no minimum" className="s-inp" />
            <span className="mt-1 block text-xs text-ink-soft">
              Below this, the messaging is hidden — banks have their own floor and quoting an EMI the
              shopper cannot get is worse than quoting none.
            </span>
          </F>
          <F label="EMI plans">
            <textarea name="emiTenures" defaultValue={v('emiTenures')} rows={5} placeholder={'12@14\n24@15'} className="s-inp font-mono text-xs" />
            <span className="mt-1 block text-xs text-ink-soft">
              One plan per line as <code className="bg-paper-2 px-1">months@annualRate</code>, e.g.{' '}
              <code className="bg-paper-2 px-1">12@14</code>. Leave blank to use the standard plans.
            </span>
          </F>

          <F label="GST state code">
            <input name="sellerStateCode" defaultValue={v('sellerStateCode')} placeholder="07" className="s-inp" />
            <span className="mt-1 block text-xs text-ink-soft">
              Two digits for your registered state — 07 Delhi, 27 Maharashtra, 29 Karnataka. Decides
              whether an invoice charges CGST+SGST or IGST, so it must match your GSTIN.
            </span>
          </F>
          <F label="Default GST %"><input name="gstPercentDefault" defaultValue={v('gstPercentDefault')} className="s-inp" /></F>
        </Grid>
      </Section>

      <Section title="Commerce rules">
        <p className="text-xs text-ink-soft mb-3">
          These drive checkout behaviour: COD availability, high-value verification, PAN capture and how long a quoted price is honoured.
        </p>
        <Grid>
          <F label="Free shipping above (₹)"><input name="freeShippingAbove" defaultValue={v('freeShippingAbove')} className="s-inp" /></F>
          <F label="Flat shipping fee (₹)"><input name="flatShippingFee" defaultValue={v('flatShippingFee')} className="s-inp" /></F>
          <F label="COD max order value (₹)"><input name="codMaxOrderValue" defaultValue={v('codMaxOrderValue')} className="s-inp" /></F>
          <F label="COD token collected online (₹)"><input name="codTokenAmount" defaultValue={v('codTokenAmount')} className="s-inp" /></F>
          <F label="Verification call above (₹)"><input name="verificationCallAbove" defaultValue={v('verificationCallAbove')} className="s-inp" /></F>
          <F label="PAN required above (₹)"><input name="panThreshold" defaultValue={v('panThreshold')} className="s-inp" /></F>
          <F label="Rate lock (minutes)"><input name="rateLockMinutes" type="number" min={1} defaultValue={v('rateLockMinutes')} className="s-inp" /></F>
        </Grid>
      </Section>

      <Section title="Social & content">
        <Grid>
          <F label="Instagram URL"><input name="instagram" defaultValue={v('instagram')} className="s-inp" /></F>
          <F label="Facebook URL"><input name="facebook" defaultValue={v('facebook')} className="s-inp" /></F>
          <F label="YouTube URL"><input name="youtube" defaultValue={v('youtube')} className="s-inp" /></F>
        </Grid>
        <F label="Return policy"><textarea name="returnPolicy" defaultValue={v('returnPolicy')} rows={2} className="s-inp" /></F>
        <F label="Footer note"><textarea name="footerNote" defaultValue={v('footerNote')} rows={2} className="s-inp" /></F>
      </Section>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {msg && <p className="text-sm text-velvet">{msg}</p>}

      <button disabled={pending} className="btn-primary">{pending ? 'Saving…' : 'Save settings'}</button>
      <style>{`.s-inp{width:100%;border:1px solid var(--line);background:#fff;padding:.5rem .625rem;font-size:.875rem;outline:none}.s-inp:focus{border-color:var(--brass)}`}</style>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-line bg-white p-5">
      <h2 className="font-heading text-lg mb-4">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{children}</div>;
}
function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block mb-1 text-xs text-ink-soft">{label}</span>{children}</label>;
}
