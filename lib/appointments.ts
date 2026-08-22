import 'server-only';
import { prisma } from '@/lib/prisma';
import { AppointmentStatus, AppointmentType, LeadSource, LeadStatus } from '@prisma/client';

/** Default slots offered when no AppointmentSlot rows are configured. */
export const DEFAULT_SLOTS = [
  '11:00-11:30', '11:30-12:00', '12:00-12:30', '12:30-13:00',
  '16:00-16:30', '16:30-17:00', '17:00-17:30', '17:30-18:00',
];

/** Slots available on a date: configured slots minus blocked minus at-capacity. */
export async function getAvailableSlots(date: Date): Promise<string[]> {
  const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);

  const [configured, booked] = await Promise.all([
    prisma.appointmentSlot.findMany({
      where: { OR: [{ date: { gte: dayStart, lt: dayEnd } }, { dayOfWeek: dayStart.getDay() }] },
    }),
    prisma.appointment.groupBy({
      by: ['slot'],
      where: { date: { gte: dayStart, lt: dayEnd }, status: { in: [AppointmentStatus.REQUESTED, AppointmentStatus.CONFIRMED] } },
      _count: true,
    }),
  ]);

  const bookedCount = new Map(booked.map((b) => [b.slot, b._count]));
  const blocked = new Set(configured.filter((c) => c.isBlocked).map((c) => c.slot));
  const capacityFor = (slot: string) => configured.find((c) => c.slot === slot && !c.isBlocked)?.capacity ?? 1;

  const universe = configured.length > 0 ? Array.from(new Set(configured.map((c) => c.slot))) : DEFAULT_SLOTS;
  return universe
    .filter((s) => !blocked.has(s))
    .filter((s) => (bookedCount.get(s) ?? 0) < capacityFor(s))
    .sort();
}

export type BookAppointmentInput = {
  type: AppointmentType;
  name: string;
  phone: string;
  email?: string | null;
  date: Date;
  slot: string;
  productId?: string | null;
  notes?: string | null;
  customerId?: string | null;
};

export class AppointmentError extends Error {}

/**
 * Book an appointment. Re-checks slot availability server-side (never trusts the
 * submitted slot), links/creates the customer, and raises a CRM lead so sales can
 * follow up (brief §25 + §39).
 */
export async function bookAppointment(input: BookAppointmentInput): Promise<{ id: string }> {
  const available = await getAvailableSlots(input.date);
  if (!available.includes(input.slot)) {
    throw new AppointmentError('That slot is no longer available. Please pick another.');
  }

  // Link to an existing customer by phone, or create one (unverified).
  const customer = input.customerId
    ? await prisma.customer.findFirst({ where: { id: input.customerId, deletedAt: null } })
    : await prisma.customer.upsert({
        where: { phone: input.phone },
        create: { phone: input.phone, name: input.name, email: input.email || undefined },
        update: { name: input.name },
      });

  const appointment = await prisma.appointment.create({
    data: {
      type: input.type,
      status: AppointmentStatus.REQUESTED,
      customerId: customer?.id ?? null,
      name: input.name,
      phone: input.phone,
      email: input.email || null,
      date: input.date,
      slot: input.slot,
      productId: input.productId || null,
      notes: input.notes || null,
    },
  });

  // Raise a CRM lead so the visit is worked by sales.
  await prisma.lead.create({
    data: {
      source: LeadSource.APPOINTMENT,
      status: LeadStatus.NEW,
      name: input.name,
      phone: input.phone,
      email: input.email || null,
      customerId: customer?.id ?? null,
      productId: input.productId || null,
      notes: `Appointment ${input.type} on ${input.date.toDateString()} ${input.slot}`,
    },
  }).catch(() => {}); // a lead failure must not lose the booking

  return { id: appointment.id };
}

export async function listAppointments(params: { status?: AppointmentStatus; upcomingOnly?: boolean }) {
  return prisma.appointment.findMany({
    where: {
      ...(params.status ? { status: params.status } : {}),
      ...(params.upcomingOnly ? { date: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } : {}),
    },
    orderBy: { date: 'asc' },
    take: 100,
    include: { staff: { select: { name: true } }, product: { select: { name: true } }, customer: { select: { id: true } } },
  });
}
