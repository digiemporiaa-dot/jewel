'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { assertPermission } from '@/lib/auth/guard';
import { softDeleteCustomer, restoreCustomer } from '@/lib/admin/soft-delete';

export type Result = { ok: boolean; error?: string };

/**
 * Remove a customer.
 *
 * Never a real delete. The row is the parent of every order that person placed;
 * deleting it either breaks those foreign keys or takes the orders with it, and
 * either way the shop has lost sales history it is required to keep.
 *
 * `anonymise` is the answer to an erasure request: the name, phone, email and
 * dates are scrubbed and the orders, their totals and their invoices remain. It
 * is one-way, which the confirmation says out loud.
 */
export async function deleteCustomerAction(id: string, typed: string, anonymise: boolean): Promise<Result> {
  const staff = await assertPermission('customers.view');

  const customer = await prisma.customer.findUnique({ where: { id }, select: { phone: true } });
  if (!customer) return { ok: false, error: 'Customer not found' };
  if (typed.trim() !== customer.phone.trim()) {
    return { ok: false, error: `Type the phone number ${customer.phone} to confirm.` };
  }

  const res = await softDeleteCustomer(id, staff.id, anonymise);
  if (!res.ok) return res;
  revalidatePath('/admin/customers');
  revalidatePath(`/admin/customers/${id}`);
  return { ok: true };
}

export async function restoreCustomerAction(id: string): Promise<Result> {
  const staff = await assertPermission('customers.view');
  const res = await restoreCustomer(id, staff.id);
  if (!res.ok) return res;
  revalidatePath('/admin/customers');
  revalidatePath(`/admin/customers/${id}`);
  return { ok: true };
}
