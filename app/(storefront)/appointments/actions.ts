'use server';

import { z } from 'zod';
import { getAvailableSlots, bookAppointment, AppointmentError } from '@/lib/appointments';
import { getCustomerId } from '@/lib/customer-session';
import { checkLimit, LIMITS } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-id';
import { getStoreSettings } from '@/lib/store';
import { sendEmail } from '@/lib/email';
import { prisma } from '@/lib/prisma';
import { AppointmentType } from '@prisma/client';

const bookSchema = z.object({
  type: z.enum(['SHOWROOM_VISIT', 'VIDEO_CONSULTATION']),
  name: z.string().trim().min(2, 'Name is required').max(80),
  phone: z.string().trim().regex(/^(\+91)?[6-9]\d{9}$/, 'Enter a valid mobile number'),
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
  date: z.string().min(1, 'Pick a date'),
  slot: z.string().min(1, 'Pick a time slot'),
  productId: z.string().optional().or(z.literal('')),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
});

export async function getSlotsAction(dateStr: string): Promise<string[]> {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return [];
  return getAvailableSlots(date);
}

export async function bookAppointmentAction(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const parsed = bookSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid details' };
  const d = parsed.data;

  // Public form — throttle per IP to prevent booking spam.
  const rl = checkLimit(`appointment:${await getClientIp()}`, LIMITS.appointment);
  if (!rl.allowed) return { ok: false, error: 'Too many requests. Please try again later.' };

  const date = new Date(d.date);
  if (Number.isNaN(date.getTime())) return { ok: false, error: 'Invalid date' };
  // Reject past dates server-side.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (date < today) return { ok: false, error: 'Please choose a future date' };

  try {
    const customerId = await getCustomerId();
    await bookAppointment({
      type: d.type as AppointmentType,
      name: d.name, phone: d.phone, email: d.email || null,
      date, slot: d.slot,
      productId: d.productId || null,
      notes: d.notes || null,
      customerId,
    });

    // Confirmation email is best-effort — never fails the booking.
    if (d.email) {
      const store = await getStoreSettings();
      sendEmail({
        to: d.email,
        subject: `Appointment requested — ${store.brandName}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:520px;color:#161513">
          <h2 style="font-family:Georgia,serif;color:#17362C">${store.brandName}</h2>
          <p>Hi ${d.name}, we've received your ${d.type === 'VIDEO_CONSULTATION' ? 'video consultation' : 'showroom visit'} request for
          <strong>${date.toDateString()}</strong> at <strong>${d.slot}</strong>.</p>
          <p>Our team will confirm shortly${store.phone ? ` — or call us on ${store.phone}` : ''}.</p>
        </div>`,
        templateKey: 'appointment_confirmation',
      });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof AppointmentError ? e.message : 'Could not book your appointment' };
  }
}

/** Products offered in the "product of interest" picker. */
export async function getInterestProducts() {
  return prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: [{ isFeatured: 'desc' }, { name: 'asc' }],
    take: 60,
  });
}
