'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateSettingsAction } from './actions';

export type SettingsDefaults = Record<string, string | number | undefined>;

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

  return (
    <form onSubmit={submit} className="space-y-6 text-sm">
      <Section title="Brand">
        <Grid>
          <F label="Brand name"><input name="brandName" defaultValue={v('brandName')} required className="s-inp" /></F>
          <F label="Tagline"><input name="tagline" defaultValue={v('tagline')} className="s-inp" /></F>
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
