import { PrismaClient } from '@prisma/client';

// Reuse a single PrismaClient across hot reloads in development to avoid
// exhausting database connections.
//
// SERVERLESS NOTE: on Vercel every warm isolate holds its own client and its own
// pool, so `DATABASE_URL` must point at a *pooled* connection string (Neon's
// `-pooler` host, Supabase's pooler on 6543, or Prisma Accelerate). Pointing it at
// a direct Postgres host will exhaust `max_connections` under load. Migrations are
// the exception — `prisma migrate deploy` needs a direct connection, so run it
// with the direct URL (see docs/VERCEL.md).
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
