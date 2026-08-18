'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { FormResult } from './actions';

type Opt = { id: string; name: string };
type Refs = {
  categories: Opt[];
  metals: Opt[];
  purities: { id: string; name: string; metalId: string }[];
  makingRules: Opt[];
};

export type ProductDefaults = Partial<{
  name: string; slug: string; sku: string; shortDescription: string; description: string;
  categoryId: string; pricingMode: string; metalId: string; purityId: string; metalColor: string;
  netWeight: string; grossWeight: string; wastagePct: string; makingChargeRuleId: string; fixedPrice: string;
  gstPercent: string; gstInclusive: boolean; fulfilmentType: string; leadTimeDays: string; advancePercent: string;
  certification: string; isActive: boolean; isFeatured: boolean; isBestSeller: boolean; isNewArrival: boolean;
  occasion: string; tags: string; seoTitle: string; seoDescription: string;
}>;

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className="btn-primary">{pending ? 'Saving…' : label}</button>;
}

export default function ProductForm({
  action, refs, defaults = {}, submitLabel,
}: {
  action: (prev: FormResult, fd: FormData) => Promise<FormResult>;
  refs: Refs;
  defaults?: ProductDefaults;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState<FormResult, FormData>(action, { ok: true });
  const [mode, setMode] = useState(defaults.pricingMode ?? 'WEIGHT_BASED');
  const [metalId, setMetalId] = useState(defaults.metalId ?? '');
  const [fulfilment, setFulfilment] = useState(defaults.fulfilmentType ?? 'READY_TO_SHIP');

  const isFixed = mode === 'FIXED';
  const purities = refs.purities.filter((p) => !metalId || p.metalId === metalId);

  return (
    <form action={formAction} className="space-y-6">
      {state && !state.ok && state.error && (
        <p role="alert" className="border border-red-300 bg-red-50 text-red-700 text-sm px-3 py-2">{state.error}</p>
      )}
      {state && state.ok && state.error === undefined && submitLabel === 'Save changes' && (
        <p className="border border-line bg-paper-2 text-sm px-3 py-2">Saved.</p>
      )}

      <Section title="Basics">
        <Grid>
          <Field label="Name"><input name="name" defaultValue={defaults.name} required className="inp" /></Field>
          <Field label="Slug"><input name="slug" defaultValue={defaults.slug} required placeholder="22k-gold-ring" className="inp" /></Field>
          <Field label="SKU"><input name="sku" defaultValue={defaults.sku} required className="inp" /></Field>
          <Field label="Category">
            <select name="categoryId" defaultValue={defaults.categoryId ?? ''} required className="inp">
              <option value="">Select…</option>
              {refs.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </Grid>
        <Field label="Short description"><input name="shortDescription" defaultValue={defaults.shortDescription} className="inp" /></Field>
        <Field label="Description"><textarea name="description" defaultValue={defaults.description} rows={3} className="inp" /></Field>
      </Section>

      <Section title="Pricing">
        <Grid>
          <Field label="Pricing mode">
            <select name="pricingMode" value={mode} onChange={(e) => setMode(e.target.value)} className="inp">
              <option value="WEIGHT_BASED">WEIGHT_BASED</option>
              <option value="COMPONENT_BASED">COMPONENT_BASED</option>
              <option value="FIXED">FIXED</option>
            </select>
          </Field>
          <Field label="GST %"><input name="gstPercent" defaultValue={defaults.gstPercent ?? '3'} className="inp" /></Field>
          <Field label="GST inclusive?">
            <label className="flex items-center gap-2 text-sm py-2"><input type="checkbox" name="gstInclusive" defaultChecked={defaults.gstInclusive} /> Price includes GST</label>
          </Field>
        </Grid>

        {isFixed ? (
          <Grid>
            <Field label="Fixed price (₹)"><input name="fixedPrice" defaultValue={defaults.fixedPrice} className="inp" /></Field>
          </Grid>
        ) : (
          <>
            <Grid>
              <Field label="Metal">
                <select name="metalId" value={metalId} onChange={(e) => setMetalId(e.target.value)} className="inp">
                  <option value="">Select…</option>
                  {refs.metals.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </Field>
              <Field label="Purity">
                <select name="purityId" defaultValue={defaults.purityId ?? ''} className="inp">
                  <option value="">Select…</option>
                  {purities.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Metal colour"><input name="metalColor" defaultValue={defaults.metalColor} placeholder="Yellow / White / Rose" className="inp" /></Field>
            </Grid>
            <Grid>
              <Field label="Net weight (g)"><input name="netWeight" defaultValue={defaults.netWeight} className="inp" /></Field>
              <Field label="Gross weight (g)"><input name="grossWeight" defaultValue={defaults.grossWeight} className="inp" /></Field>
              <Field label="Wastage %"><input name="wastagePct" defaultValue={defaults.wastagePct ?? '0'} className="inp" /></Field>
              <Field label="Making charge rule">
                <select name="makingChargeRuleId" defaultValue={defaults.makingChargeRuleId ?? ''} className="inp">
                  <option value="">Auto-resolve</option>
                  {refs.makingRules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </Field>
            </Grid>
          </>
        )}
      </Section>

      <Section title="Fulfilment">
        <Grid>
          <Field label="Type">
            <select name="fulfilmentType" value={fulfilment} onChange={(e) => setFulfilment(e.target.value)} className="inp">
              <option value="READY_TO_SHIP">READY_TO_SHIP</option>
              <option value="MADE_TO_ORDER">MADE_TO_ORDER</option>
            </select>
          </Field>
          {fulfilment === 'MADE_TO_ORDER' && (
            <>
              <Field label="Lead time (days)"><input name="leadTimeDays" defaultValue={defaults.leadTimeDays} className="inp" /></Field>
              <Field label="Advance %"><input name="advancePercent" defaultValue={defaults.advancePercent} className="inp" /></Field>
            </>
          )}
          <Field label="Certification"><input name="certification" defaultValue={defaults.certification} placeholder="BIS Hallmark 916 / IGI" className="inp" /></Field>
        </Grid>
      </Section>

      <Section title="Merchandising">
        <div className="flex flex-wrap gap-4 text-sm">
          <Check name="isActive" label="Active" defaultChecked={defaults.isActive ?? true} />
          <Check name="isFeatured" label="Featured" defaultChecked={defaults.isFeatured} />
          <Check name="isBestSeller" label="Best seller" defaultChecked={defaults.isBestSeller} />
          <Check name="isNewArrival" label="New arrival" defaultChecked={defaults.isNewArrival} />
        </div>
        <Grid>
          <Field label="Occasions (comma-separated)"><input name="occasion" defaultValue={defaults.occasion} placeholder="Wedding, Gifting" className="inp" /></Field>
          <Field label="Tags (comma-separated)"><input name="tags" defaultValue={defaults.tags} placeholder="gold, ring, 22k" className="inp" /></Field>
        </Grid>
      </Section>

      <Section title="SEO">
        <Field label="SEO title"><input name="seoTitle" defaultValue={defaults.seoTitle} className="inp" /></Field>
        <Field label="SEO description"><textarea name="seoDescription" defaultValue={defaults.seoDescription} rows={2} className="inp" /></Field>
      </Section>

      <Submit label={submitLabel} />

      <style>{`.inp{width:100%;border:1px solid var(--line);background:#fff;padding:.5rem .625rem;font-size:.875rem;outline:none}.inp:focus{border-color:var(--brass)}`}</style>
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
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm"><span className="block mb-1 text-xs text-ink-soft">{label}</span>{children}</label>;
}
function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return <label className="flex items-center gap-2"><input type="checkbox" name={name} defaultChecked={defaultChecked} /> {label}</label>;
}
