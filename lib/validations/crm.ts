import { z } from 'zod';

export const leadCreateSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(80),
  phone: z.string().trim().regex(/^(\+91)?[6-9]\d{9}$/, 'Enter a valid mobile number'),
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
  source: z.enum(['WEBSITE', 'WHATSAPP', 'PHONE', 'APPOINTMENT', 'ABANDONED_CART', 'WALK_IN', 'REFERRAL']).default('PHONE'),
  productId: z.string().optional().or(z.literal('')),
  estimatedValue: z.string().trim().refine((v) => v === '' || /^\d+(\.\d{1,2})?$/.test(v), 'Enter a valid amount').optional(),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
  assignedToId: z.string().optional().or(z.literal('')),
});

export const leadUpdateSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'FOLLOW_UP', 'NEGOTIATION', 'CONVERTED', 'LOST']),
  assignedToId: z.string().optional().or(z.literal('')),
  estimatedValue: z.string().trim().refine((v) => v === '' || /^\d+(\.\d{1,2})?$/.test(v), 'Enter a valid amount').optional(),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
});

export const followUpSchema = z.object({
  leadId: z.string().min(1),
  dueAt: z.string().min(1, 'Pick a date'),
  note: z.string().trim().max(500).optional().or(z.literal('')),
});

export const callLogSchema = z.object({
  leadId: z.string().min(1),
  outcome: z.string().trim().min(1, 'Outcome is required').max(80),
  notes: z.string().trim().max(1000).optional().or(z.literal('')),
});
