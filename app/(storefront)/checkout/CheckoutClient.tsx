'use client';

import { useState, useTransition, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import { sendCheckoutOtp, verifyCheckoutOtp, placeOrder, confirmCheckoutPayment, previewCouponAction, type CouponPreview } from './actions';
import { trackEcommerce, type EventItem } from '@/lib/marketing/events';
import { resolvePayable, type SummaryTotals } from '@/lib/checkout/totals';
import CheckoutSummary from './CheckoutSummary';
import type { SummaryLine } from '@/components/storefront/OrderSummary';

declare global {
  interface Window { Razorpay?: new (opts: unknown) => { open: () => void } }
}

export default function CheckoutClient({
  summary, lines, verifiedPhone, panRequired, codAllowed, brandName, analyticsItems,
}: {
  summary: SummaryTotals; lines: SummaryLine[];
  verifiedPhone: string | null; panRequired: boolean; codAllowed: boolean; brandName: string;
  analyticsItems: EventItem[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  // `begin_checkout` marks reaching this page, not completing it, so it fires
  // once on mount. The ref survives React's development double-invoke of effects.
  const checkoutTracked = useRef(false);

  // Contact + OTP
  const [name, setName] = useState('');
  const [phone, setPhone] = useState(verifiedPhone ?? '');
  const [email, setEmail] = useState('');
  const [verified, setVerified] = useState(!!verifiedPhone);
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);

  // Address
  const [addr, setAddr] = useState({ line1: '', line2: '', city: '', state: '', pincode: '' });
  const [pan, setPan] = useState('');
  const [method, setMethod] = useState<'RAZORPAY' | 'COD' | 'BANK_TRANSFER'>('RAZORPAY');

  const [error, setError] = useState<string | null>(null);

  // Coupon. The preview is advisory — the authoritative check runs again when
  // the order is created, so the code is what gets submitted, never the amount.
  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState<CouponPreview | null>(null);
  const [couponPending, setCouponPending] = useState(false);

  // THE single source of truth for what the shopper pays. The Total row, the
  // button label, the cash-on-delivery wording and the analytics value all read
  // `totals.grandTotal`. Nothing in this component may reach past it to
  // `summary.grandTotal` — that split is exactly what made the button advertise
  // a different figure from the Total above it.
  const totals = resolvePayable(summary, coupon?.ok ? coupon : null);

  // `begin_checkout` marks reaching this page, not completing it, so it fires
  // once on mount — before any code could have been applied. The ref survives
  // React's development double-invoke of effects.
  useEffect(() => {
    if (checkoutTracked.current || analyticsItems.length === 0) return;
    checkoutTracked.current = true;
    trackEcommerce('begin_checkout', {
      currency: 'INR',
      value: Number(totals.grandTotal),
      items: analyticsItems,
    });
  }, [analyticsItems, totals.grandTotal]);

  function applyCoupon() {
    if (!couponInput.trim()) return;
    setCouponPending(true);
    void previewCouponAction(couponInput).then((res) => {
      setCoupon(res);
      setCouponPending(false);
    });
  }

  function sendCode() {
    setError(null);
    start(async () => {
      const res = await sendCheckoutOtp(phone);
      if (res.ok) { setOtpSent(true); setDevCode(res.devCode ?? null); }
      else setError(res.error ?? 'Could not send code');
    });
  }
  function verify() {
    setError(null);
    start(async () => {
      const res = await verifyCheckoutOtp(phone, otp);
      if (res.ok) setVerified(true);
      else setError(res.error ?? 'Invalid code');
    });
  }

  function submit() {
    setError(null);
    start(async () => {
      const res = await placeOrder({
        contactName: name, contactPhone: phone, contactEmail: email, pan,
        shippingAddress: { name, phone, ...addr, country: 'India' },
        paymentMethod: method,
        couponCode: coupon?.ok ? coupon.code : '',
      });

      if (res.stage === 'error') { setError(res.error); return; }
      if (res.stage === 'done' || res.stage === 'bank') { router.push(`/order/${res.orderNumber}`); return; }

      // stage === 'pay'
      if (res.razorpay.dev) {
        // Simulated gateway (no live keys): confirm with a dev token.
        const payId = `pay_dev_${Math.random().toString(36).slice(2, 12)}`;
        const confirm = await confirmCheckoutPayment({ orderId: res.orderId, razorpayPaymentId: payId, razorpayOrderId: res.razorpay.orderId, signature: 'dev_signature' });
        if (confirm.ok) router.push(`/order/${confirm.orderNumber}`);
        else setError(confirm.error ?? 'Payment failed');
        return;
      }

      // Live Razorpay checkout.
      await loadRazorpay();
      if (!window.Razorpay || !res.razorpay.keyId) { setError('Payment unavailable — please try again'); return; }
      const rzp = new window.Razorpay({
        key: res.razorpay.keyId,
        amount: res.razorpay.amount,
        currency: 'INR',
        name: brandName,
        order_id: res.razorpay.orderId,
        prefill: { name: res.prefill.name, email: res.prefill.email, contact: res.prefill.phone },
        // EMI and cardless EMI are offered alongside the usual methods. The bank
        // sets the actual tenure and rate here — the figures shown on the
        // product page and in the bag are indicative only.
        method: { emi: true, cardless_emi: true },
        handler: async (r: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
          const confirm = await confirmCheckoutPayment({ orderId: res.orderId, razorpayPaymentId: r.razorpay_payment_id, razorpayOrderId: r.razorpay_order_id, signature: r.razorpay_signature });
          if (confirm.ok) router.push(`/order/${confirm.orderNumber}`);
          else setError(confirm.error ?? 'Payment could not be verified');
        },
      });
      rzp.open();
    });
  }

  const canPlace = Boolean(
    verified && name && phone && addr.line1 && addr.city && addr.state &&
    /^\d{6}$/.test(addr.pincode) && (!panRequired || pan.length === 10)
  );

  return (
    <div className="grid lg:grid-cols-[1.5fr_1fr] gap-8">
      <div className="space-y-6">
        {/* Contact */}
        <Section step="1" title="Contact & verification">
          <div className="grid sm:grid-cols-2 gap-3">
            <Input label="Full name" value={name} onChange={setName} />
            <Input label="Email (for confirmation)" value={email} onChange={setEmail} type="email" />
          </div>
          <div className="flex gap-2 items-end mt-3">
            <Input label="Mobile number" value={phone} onChange={(v) => { setPhone(v); setVerified(false); setOtpSent(false); }} disabled={verified} className="flex-1" />
            {!verified && <button onClick={sendCode} disabled={pending || phone.length < 10} className="btn-outline text-xs h-[42px]">{otpSent ? 'Resend' : 'Send OTP'}</button>}
          </div>
          {verified && <p className="text-xs text-velvet mt-1">✓ Phone verified</p>}
          {otpSent && !verified && (
            <div className="mt-3 flex gap-2 items-end">
              <Input label="Enter OTP" value={otp} onChange={setOtp} className="flex-1" />
              <button onClick={verify} disabled={pending || otp.length !== 6} className="btn-primary text-xs h-[42px]">Verify</button>
            </div>
          )}
          {devCode && !verified && <p className="text-xs text-ink-soft mt-1">Dev code: <strong>{devCode}</strong></p>}
        </Section>

        {/* Address */}
        <Section step="2" title="Shipping address">
          <div className="space-y-3">
            <Input label="Address line 1" value={addr.line1} onChange={(v) => setAddr({ ...addr, line1: v })} />
            <Input label="Address line 2 (optional)" value={addr.line2} onChange={(v) => setAddr({ ...addr, line2: v })} />
            <div className="grid sm:grid-cols-3 gap-3">
              <Input label="City" value={addr.city} onChange={(v) => setAddr({ ...addr, city: v })} />
              <Input label="State" value={addr.state} onChange={(v) => setAddr({ ...addr, state: v })} />
              <Input label="Pincode" value={addr.pincode} onChange={(v) => setAddr({ ...addr, pincode: v.replace(/\D/g, '').slice(0, 6) })} />
            </div>
            {panRequired && (
              <Input label="PAN (required for this order value)" value={pan} onChange={(v) => setPan(v.toUpperCase().slice(0, 10))} />
            )}
          </div>
        </Section>

        {/* Payment */}
        <Section step="3" title="Payment method">
          <div className="space-y-2">
            <Method id="RAZORPAY" active={method === 'RAZORPAY'} onClick={() => setMethod('RAZORPAY')} title="Pay online (UPI / Card / Netbanking)" desc="Secure payment via Razorpay" />
            <Method id="COD" active={method === 'COD'} onClick={() => codAllowed && setMethod('COD')} title="Cash on delivery" desc={codAllowed ? 'Pay when your order arrives' : 'Not available for this order value'} disabled={!codAllowed} />
            <Method id="BANK_TRANSFER" active={method === 'BANK_TRANSFER'} onClick={() => setMethod('BANK_TRANSFER')} title="Bank transfer" desc="Transfer to our account; we confirm manually" />
          </div>
        </Section>

        {error && <p role="alert" className="text-sm text-red-700 border border-red-300 bg-red-50 px-3 py-2">{error}</p>}
      </div>

      <CheckoutSummary
        lines={lines}
        totals={totals}
        itemsTotal={summary.itemsTotal}
        method={method}
        pending={pending}
        canPlace={canPlace}
        verified={verified}
        couponInput={couponInput}
        couponPending={couponPending}
        couponFeedback={
          coupon === null
            ? null
            : coupon.ok
              ? { ok: true, freeShipping: coupon.freeShipping, discount: coupon.discount, appliesTo: coupon.appliesTo }
              : { ok: false, error: coupon.error }
        }
        onCouponInput={(v) => { setCouponInput(v); setCoupon(null); }}
        onApplyCoupon={applyCoupon}
        onSubmit={submit}
      />
    </div>
  );
}

async function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return;
  await new Promise<void>((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.body.appendChild(s);
  });
}

function Section({ step, title, children }: { step: string; title: string; children: React.ReactNode }) {
  return (
    <div className="border border-line bg-white p-5">
      <h2 className="font-heading text-lg mb-4 flex items-center gap-2">
        <span className="grid place-items-center h-6 w-6 text-xs bg-velvet text-paper rounded-full">{step}</span>{title}
      </h2>
      {children}
    </div>
  );
}
function Input({ label, value, onChange, type = 'text', disabled, className }: { label: string; value: string; onChange: (v: string) => void; type?: string; disabled?: boolean; className?: string }) {
  return (
    <label className={cn('block text-sm', className)}>
      <span className="block mb-1 text-xs text-ink-soft">{label}</span>
      <input type={type} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="w-full border border-line px-3 py-2.5 outline-none focus:border-brass disabled:bg-paper-2" />
    </label>
  );
}
function Method({ active, onClick, title, desc, disabled }: { id: string; active: boolean; onClick: () => void; title: string; desc: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={cn('w-full text-left border p-3 rounded-[2px] transition-colors', active ? 'border-velvet bg-paper-2' : 'border-line hover:border-brass', disabled && 'opacity-50 cursor-not-allowed')}>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-ink-soft">{desc}</p>
    </button>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-ink-soft"><dt>{label}</dt><dd className="text-ink">{value}</dd></div>;
}
