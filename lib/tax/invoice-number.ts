import 'server-only';
import type { Prisma } from '@prisma/client';
import { financialYearFor, formatInvoiceNumber } from '@/lib/tax/gst';

/**
 * Allocate the next invoice number in the store's series.
 *
 * A GST invoice series must be **sequential and gap-free**, which rules out the
 * two obvious shortcuts:
 *
 *  - counting orders — a cancelled or never-paid order would leave a hole;
 *  - reading the maximum and adding one — two concurrent checkouts read the same
 *    maximum and both take the same number.
 *
 * Instead a counter row per financial year is incremented with `UPDATE …
 * RETURNING`, which takes a row lock for the remainder of the transaction. A
 * second checkout blocks on that lock until the first commits, then reads the
 * incremented value. This must therefore be called **inside** the order
 * transaction, so the number and the order are committed together or not at all.
 *
 * `Order.invoiceNumber` also carries a unique index, so even a future caller that
 * bypassed this function could not produce a duplicate.
 */
export async function allocateInvoiceNumber(
  tx: Prisma.TransactionClient,
  params: { prefix: string; at?: Date }
): Promise<{ invoiceNumber: string; financialYear: string; sequence: number }> {
  const financialYear = financialYearFor(params.at ?? new Date());

  // Upsert-then-increment in one statement. `ON CONFLICT DO UPDATE` makes the
  // first order of a financial year and every subsequent one take the same path,
  // and holds the row lock either way.
  const rows = await tx.$queryRaw<{ lastNumber: number }[]>`
    INSERT INTO "InvoiceCounter" ("id", "financialYear", "lastNumber", "updatedAt")
    VALUES (gen_random_uuid()::text, ${financialYear}, 1, NOW())
    ON CONFLICT ("financialYear")
    DO UPDATE SET "lastNumber" = "InvoiceCounter"."lastNumber" + 1, "updatedAt" = NOW()
    RETURNING "lastNumber"
  `;

  const sequence = rows[0]?.lastNumber;
  if (typeof sequence !== 'number') {
    // Refusing to invent a number is the only safe failure here: a duplicate or
    // out-of-sequence invoice is far worse than an order that did not complete.
    throw new Error('Could not allocate an invoice number');
  }

  return {
    invoiceNumber: formatInvoiceNumber(params.prefix, financialYear, sequence),
    financialYear,
    sequence,
  };
}
