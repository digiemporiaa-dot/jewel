'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { assertPermission } from '@/lib/auth/guard';
import { prisma } from '@/lib/prisma';
import { AppointmentStatus } from '@prisma/client';

export type Result = { ok: boolean; error?: string };

const updateSchema = z.object({
  id: z.string().min(1),
  status: z.nativeEnum(AppointmentStatus),
  staffId: z.string().optional().or(z.literal('')),
});

export async function updateAppointmentAction(id: string, status: string, staffId: string): Promise<Result> {
  await assertPermission('appointments.manage');
  const parsed = updateSchema.safeParse({ id, status, staffId });
  if (!parsed.success) return { ok: false, error: 'Invalid input' };

  await prisma.appointment.update({
    where: { id: parsed.data.id },
    data: {
      status: parsed.data.status,
      staffId: parsed.data.staffId || null,
    },
  });
  revalidatePath('/admin/appointments');
  return { ok: true };
}
