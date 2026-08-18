'use server';

import { redirect } from 'next/navigation';
import { clearCustomerSession } from '@/lib/customer-session';

export async function logoutAction() {
  await clearCustomerSession();
  redirect('/');
}
