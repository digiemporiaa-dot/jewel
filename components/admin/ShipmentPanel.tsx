'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatDate } from '@/lib/utils/format';
import {
  createShipmentAction, assignAwbAction, schedulePickupAction,
  generateLabelAction, generateManifestAction, refreshTrackingAction, refreshFromCourierAction, type Result,
} from '@/app/admin/(protected)/shipments/actions';
import { display } from '@/lib/shipping/parse';

export type ShipmentView = {
  exists: boolean;
  status: string | null;
  awb: string | null;
  courier: string | null;
  trackingUrl: string | null;
  labelUrl: string | null;
  manifestUrl: string | null;
  pickupScheduledAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  ndrReason: string | null;
};

export default function ShipmentPanel({ orderId, shipment }: { orderId: string; shipment: ShipmentView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run(fn: () => Promise<Result>) {
    setMsg(null);
    start(async () => {
      const res = await fn();
      setMsg(res.ok ? res.info ?? 'Done' : res.error ?? 'Failed');
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="border border-line bg-white p-5 text-sm">
      <h2 className="font-heading text-lg mb-3">Shipment</h2>

      {!shipment.exists ? (
        <div>
          <p className="text-ink-soft mb-3">No shipment yet.</p>
          <button disabled={pending} onClick={() => run(() => createShipmentAction(orderId))} className="btn-primary text-xs">Create shipment</button>
        </div>
      ) : (
        <div className="space-y-3">
          <dl className="space-y-1">
            <Row label="Status" value={display(shipment.status?.replace(/_/g, ' '))} />
            <Row label="AWB" value={display(shipment.awb)} />
            <Row label="Courier" value={display(shipment.courier)} />
            {shipment.pickupScheduledAt && <Row label="Pickup" value={formatDate(shipment.pickupScheduledAt)} />}
            {shipment.shippedAt && <Row label="Shipped" value={formatDate(shipment.shippedAt)} />}
            {shipment.deliveredAt && <Row label="Delivered" value={formatDate(shipment.deliveredAt)} />}
            {shipment.ndrReason && <Row label="NDR" value={display(shipment.ndrReason)} />}
          </dl>

          {!shipment.awb && (
            // A shipment exists at the courier but we hold no waybill for it.
            // Said plainly, because the alternative — a row of dashes — reads
            // as "nothing has happened yet", and a courier may already be on
            // the way.
            <p className="border border-brass/40 bg-brass/5 px-3 py-2 text-xs text-ink">
              AWB not recorded — check the courier dashboard. If it shows a waybill, press
              &ldquo;Refresh from courier&rdquo; rather than creating another shipment.
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-2 border-t border-line">
            {!shipment.awb && <button disabled={pending} onClick={() => run(() => assignAwbAction(orderId))} className="btn-outline text-xs">Assign AWB</button>}
            <button disabled={pending} onClick={() => run(() => refreshFromCourierAction(orderId))} className="btn-outline text-xs">Refresh from courier</button>
            {shipment.awb && <button disabled={pending} onClick={() => run(() => schedulePickupAction(orderId))} className="btn-outline text-xs">Schedule pickup</button>}
            {shipment.awb && <button disabled={pending} onClick={() => run(() => generateLabelAction(orderId))} className="btn-outline text-xs">Label</button>}
            {shipment.awb && <button disabled={pending} onClick={() => run(() => generateManifestAction(orderId))} className="btn-outline text-xs">Manifest</button>}
            {shipment.awb && <button disabled={pending} onClick={() => run(() => refreshTrackingAction(orderId))} className="btn-outline text-xs">Refresh tracking</button>}
          </div>

          <div className="flex flex-wrap gap-3 text-xs">
            {shipment.trackingUrl && <a href={shipment.trackingUrl} target="_blank" rel="noreferrer" className="underline hover:text-brass">Track</a>}
            {shipment.labelUrl && <a href={shipment.labelUrl} target="_blank" rel="noreferrer" className="underline hover:text-brass">Label PDF</a>}
            {shipment.manifestUrl && <a href={shipment.manifestUrl} target="_blank" rel="noreferrer" className="underline hover:text-brass">Manifest PDF</a>}
          </div>
        </div>
      )}

      {msg && <p className="mt-3 text-xs text-ink-soft break-all">{msg}</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between"><dt className="text-ink-soft">{label}</dt><dd className="text-ink text-right break-all">{value}</dd></div>;
}
