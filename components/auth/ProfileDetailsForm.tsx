'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { completeSignup } from '@/app/(storefront)/signup/actions';
import {
  DOB_PURPOSE, ANNIVERSARY_PURPOSE, GENDER_PURPOSE, MINOR_CONSENT_NOTICE,
  GENDERS, GENDER_LABELS, type Gender,
} from '@/lib/validations/signup';

/**
 * The details half of signing up, after the address has been proven.
 *
 * Lifted out of the old `/signup` page so the one auth panel can show it inline
 * — the customer never leaves the page they started on. Nothing about the
 * fields changed in the move; what changed is that there is now a single place
 * they are defined, rather than a page and a panel drifting apart.
 *
 * Mobile first: one field per row at every width. These are a name, a number,
 * two dates and a choice, and a two-column grid on a phone turns each of them
 * into something you have to zoom to hit.
 */

export type ProfileInitial = {
  name: string; phone: string; dob: string; anniversary: string;
  gender: Gender | ''; marketingOptIn: boolean;
};

export default function ProfileDetailsForm({
  initial, email, onDone, submitLabel = 'Create account',
}: {
  initial?: ProfileInitial | null;
  /** The verified address, shown so the customer can see what it is attached to. */
  email: string | null;
  onDone: (result: { notice: string | null }) => void;
  submitLabel?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: initial?.name ?? '',
    phone: initial?.phone ?? '',
    dob: initial?.dob ?? '',
    // Empty rather than a pre-selected option: defaulting to one would record an
    // answer the customer never gave, on a field a record may legitimately lack.
    gender: (initial?.gender ?? '') as Gender | '',
    anniversary: initial?.anniversary ?? '',
    // Never pre-ticked, even for somebody returning to complete their profile:
    // agreeing is an act, and a box that arrives already ticked has not recorded
    // one.
    acceptTerms: false,
    // Unticked. Under the DPDP Act consent has to be freely given and specific,
    // and a box that arrives already ticked is not a choice the customer made.
    marketingOptIn: initial?.marketingOptIn ?? false,
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setFieldError(null);
    start(async () => {
      const res = await completeSignup(form);
      if (!res.ok) {
        setError(res.error);
        setFieldError(res.field ?? null);
        return;
      }
      // The refusal is passed up rather than swallowed: a minor asked for
      // something and did not get it, and they are entitled to know why.
      onDone({ notice: res.refusedBecause === 'minor' ? MINOR_CONSENT_NOTICE : null });
    });
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      {email && (
        <p className="border border-line bg-paper-2/60 px-3 py-2 text-xs text-ink-soft">
          Signing up as <span className="text-ink">{email}</span> — already verified.
        </p>
      )}

      <L label="Full name">
        <input required autoComplete="name" value={form.name} onChange={(e) => set('name', e.target.value)} className="s-inp" />
      </L>

      {/* Required, and the one field here nothing verifies. It is how a courier
          reaches you, so it is checked hard on the server — see
          lib/validations/phone.ts. */}
      <L label="Mobile number" hint="For delivery updates. We do not send a code to it." invalid={fieldError === 'phone'}>
        <input
          required inputMode="numeric" autoComplete="tel" value={form.phone}
          onChange={(e) => set('phone', e.target.value)} className="s-inp"
        />
      </L>

      {/* Purpose stated at the point of collection, not buried in a policy page.
          It is what the DPDP Act asks for, and it is also the reason people
          answer: an unexplained date-of-birth box reads as a data grab. */}
      <L label="Date of birth" hint={DOB_PURPOSE} invalid={fieldError === 'dob'}>
        <input
          required type="date" value={form.dob} max={today()}
          onChange={(e) => set('dob', e.target.value)} className="s-inp"
        />
      </L>

      <L label="How would you like to be addressed?" hint={GENDER_PURPOSE} invalid={fieldError === 'gender'}>
        <select required value={form.gender} onChange={(e) => set('gender', e.target.value as Gender | '')} className="s-inp">
          <option value="" disabled>Choose one</option>
          {GENDERS.map((g) => (
            <option key={g} value={g}>{GENDER_LABELS[g]}</option>
          ))}
        </select>
      </L>

      <L label="Anniversary (optional)" hint={ANNIVERSARY_PURPOSE} invalid={fieldError === 'anniversary'}>
        <input
          type="date" value={form.anniversary} max={today()}
          onChange={(e) => set('anniversary', e.target.value)} className="s-inp"
        />
      </L>

      {/* Required. Agreeing to the terms is a condition of having an account,
          which is exactly why it is a box of its own and not bundled with
          anything optional. */}
      <label className="flex items-start gap-2.5 border border-line bg-paper-2/50 p-3 text-sm">
        <input type="checkbox" required checked={form.acceptTerms} onChange={(e) => set('acceptTerms', e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          I accept the{' '}
          <Link href="/pages/terms" target="_blank" className="underline decoration-line-strong underline-offset-4 hover:text-brass">Terms &amp; Conditions</Link>
          {' '}and the{' '}
          <Link href="/pages/privacy" target="_blank" className="underline decoration-line-strong underline-offset-4 hover:text-brass">Privacy Policy</Link>.
        </span>
      </label>

      {/* Separate, optional, and unticked — deliberately not folded into the box
          above. Under the DPDP Act marketing consent has to be free and
          specific, and consent nobody could refuse without losing their account
          is neither. */}
      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" checked={form.marketingOptIn} onChange={(e) => set('marketingOptIn', e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="text-ink-soft">Also send me offers, new collections and metal-rate alerts. Optional.</span>
      </label>

      <button disabled={pending} className="btn-primary w-full min-h-[48px]">
        {pending ? 'Saving…' : submitLabel}
      </button>

      {error && <p className="text-sm text-red-700">{error}</p>}
    </form>
  );
}

/** `<input type="date" max>` wants a local calendar day, not an ISO instant. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function L({
  label, hint, invalid, children,
}: {
  label: string; hint?: string; invalid?: boolean; children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="block mb-1 text-xs text-ink-soft">{label}</span>
      {hint && <span className="mb-1.5 block text-xs text-ink-soft/85">{hint}</span>}
      <span className={invalid ? 'block [&_input]:border-red-400 [&_select]:border-red-400' : 'block'}>{children}</span>
    </label>
  );
}
