'use server';

import { z } from 'zod';
import { getAvailableSlots, bookAppointment, AppointmentError } from '@/lib/appointments';
import { getCustomerId } from '@/lib/customer-session';
import { checkLimit, LIMITS } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-id';
import { sendTemplate } from '@/lib/templates';
import { prisma } from '@/lib/prisma';
import { AppointmentType } from '@prisma/client';
import { phoneField } from '@/lib/validations/phone';

const bookSchema = z.object({
  type: z.enum(['SHOWROOM_VISIT', 'VIDEO_CONSULTATION']),
  name: z.string().trim().min(2, 'Name is required').max(80),
  // The shared rule, not a fifth regex. Booking a showroom visit is exactly the
  // case where a wrong number costs somebody a wasted afternoon.
  phone: phoneField,
  // Required, like every other path that creates a customer record: it is what
  // the confirmation and any change of time are sent to.
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(160),
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
  const rl = await checkLimit(`appointment:${await getClientIp()}`, LIMITS.appointment);
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
      name: d.name, phone: d.phone, email: d.email,
      date, slot: d.slot,
      productId: d.productId || null,
      notes: d.notes || null,
      customerId,
    });

    // Confirmation email is best-effort — never fails the booking.
    if (d.email) {
      void sendTemplate({
        key: 'appointment_confirmation',
        to: d.email,
        values: {
          name: d.name,
          appointment_type: d.type === 'VIDEO_CONSULTATION' ? 'video consultation' : 'showroom visit',
          appointment_date: date.toDateString(),
          appointment_slot: d.slot,
        },
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
    where: { isActive: true, deletedAt: null },
    select: { id: true, name: true },
    orderBy: [{ isFeatured: 'desc' }, { name: 'asc' }],
    take: 60,
  });
}
