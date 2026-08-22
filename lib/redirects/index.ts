import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  normalisePath, classifyTarget, checkRule, isReservedPath,
  wouldLoop, flattenTarget, restitchInbound,
  type RedirectStatus,
} from '@/lib/redirects/rules';

/**
 * Storing redirects.
 *
 * The pure rules in `rules.ts` decide what is legal; this decides what happens
 * to the rest of the table when a legal rule is saved. Two things always happen,
 * and both exist to keep chains from accumulating:
 *
 *  - the new rule is **flattened** to where its target actually ends up;
 *  - rules that pointed at the new rule's source are **re-pointed** past it.
 *
 * Left alone, a shop that renames a product three times ends up with A→B→C→D,
 * which costs a little ranking and three round trips on a mobile connection for
 * anyone following the oldest link.
 */

export type SaveResult = { ok: true; id: string } | { ok: false; error: string };

/** Every active rule, as the `from → to` map the pure helpers expect. */
async function ruleMap(excludeFrom?: string): Promise<Map<string, string>> {
  const rows = await prisma.redirect.findMany({
    where: { isActive: true },
    select: { fromPath: true, toPath: true },
  });
  const map = new Map<string, string>();
  for (const row of rows) {
    if (excludeFrom && row.fromPath === excludeFrom) continue;
    map.set(row.fromPath, row.toPath);
  }
  return map;
}

export type SaveInput = {
  fromPath: string;
  toPath: string;
  statusCode: number;
  note?: string | null;
  isActive?: boolean;
  isAutomatic?: boolean;
  createdBy?: string | null;
};

/**
 * Create or replace a redirect.
 *
 * Upserts on `fromPath` rather than failing: an operator re-adding a rule for a
 * path that already has one means "point it here now", and a unique-constraint
 * error would be a worse answer than doing that.
 */
export async function saveRedirect(input: SaveInput): Promise<SaveResult> {
  const check = checkRule(input);
  if (!check.ok) return { ok: false, error: check.error };

  const fromPath = normalisePath(input.fromPath);

  // Enforced here as well as in the middleware. A rule on /checkout would be a
  // shop that cannot take money, so it must be impossible to store one.
  if (isReservedPath(fromPath)) {
    return { ok: false, error: `${fromPath} is part of the shop itself and cannot be redirected.` };
  }

  const existing = await ruleMap(fromPath);

  if (wouldLoop({ fromPath, toPath: input.toPath }, existing)) {
    return {
      ok: false,
      error: 'That would create a loop — the destination leads back here, and a browser following it would never arrive.',
    };
  }

  const toPath = flattenTarget({ fromPath, toPath: input.toPath }, existing);
  const statusCode = input.statusCode as RedirectStatus;

  const saved = await prisma.redirect.upsert({
    where: { fromPath },
    create: {
      fromPath, toPath, statusCode,
      note: input.note ?? null,
      isActive: input.isActive ?? true,
      isAutomatic: input.isAutomatic ?? false,
      createdBy: input.createdBy ?? null,
    },
    update: {
      toPath, statusCode,
      note: input.note ?? null,
      isActive: input.isActive ?? true,
    },
    select: { id: true },
  });

  // Anything that pointed at this path now points past it.
  const updates = restitchInbound({ fromPath, toPath }, existing);
  for (const update of updates) {
    await prisma.redirect
      .update({ where: { fromPath: update.fromPath }, data: { toPath: update.toPath } })
      .catch(() => {
        /* a rule deleted mid-restitch is not worth failing the save over */
      });
  }

  return { ok: true, id: saved.id };
}

/**
 * Raise a redirect because a slug changed.
 *
 * The whole point of the feature. Renaming a product breaks every link to it
 * that already exists — in Google's index, in a customer's WhatsApp history, in
 * whatever the shop paid to advertise — and nobody remembers to add a redirect
 * by hand at the moment they are busy renaming something.
 *
 * Best-effort and never throws: losing a redirect is a shame, but failing the
 * rename that the operator actually asked for would be worse.
 */
export async function recordSlugChange(params: {
  prefix: string;
  oldSlug: string;
  newSlug: string;
  staffId?: string | null;
}): Promise<void> {
  const { prefix, oldSlug, newSlug } = params;
  if (!oldSlug || !newSlug || oldSlug === newSlug) return;

  try {
    // Release the new path first. Renaming back — the ordinary "undo that" —
    // would otherwise leave the earlier rule pointing the now-live page away
    // from itself: a visitor to the correct URL gets sent to a slug nothing
    // serves any more. A path that a real page occupies cannot also be a
    // redirect source.
    await releasePath(`${prefix}/${newSlug}`);

    await saveRedirect({
      fromPath: `${prefix}/${oldSlug}`,
      toPath: `${prefix}/${newSlug}`,
      statusCode: 301,
      note: `Slug changed ${new Date().toISOString().slice(0, 10)}`,
      isAutomatic: true,
      createdBy: params.staffId ?? null,
    });
  } catch (e) {
    console.error('[redirects] could not record slug change', prefix, oldSlug, e);
  }
}

/**
 * Stop redirecting a path, because something real now lives there.
 *
 * An automatic rule is deleted: it was created by a rename, and the rename it
 * described has been undone, so there is nothing to keep. A hand-written rule is
 * only switched off — somebody typed it for a reason, and the record of what
 * they meant is worth more than the tidiness of removing it.
 */
export async function releasePath(path: string): Promise<void> {
  const fromPath = normalisePath(path);
  if (!fromPath || fromPath === '/') return;

  const existing = await prisma.redirect.findUnique({
    where: { fromPath },
    select: { id: true, isAutomatic: true },
  });
  if (!existing) return;

  if (existing.isAutomatic) {
    await prisma.redirect.delete({ where: { fromPath } });
  } else {
    await prisma.redirect.update({ where: { fromPath }, data: { isActive: false } });
  }
}

/**
 * Record that a rule was used.
 *
 * Fire-and-forget from a route handler, never from the middleware: the redirect
 * response must not wait on a write, and the Edge cannot reach Prisma anyway.
 */
export async function countHit(fromPath: string): Promise<void> {
  try {
    await prisma.redirect.update({
      where: { fromPath: normalisePath(fromPath) },
      data: { hitCount: { increment: 1 }, lastHitAt: new Date() },
    });
  } catch {
    /* a hit on a rule that has since been deleted is not an error */
  }
}

export type ImportSummary = {
  created: number;
  updated: number;
  skipped: { line: number; raw: string; error: string }[];
};

/**
 * Apply a parsed CSV.
 *
 * Rules are applied one at a time rather than in a single `createMany`, because
 * each one has to be checked against the table as it stands *after* the previous
 * one — a file containing A→B and B→A is a loop that only the second row reveals.
 */
export async function importRedirects(
  rules: { fromPath: string; toPath: string; statusCode: number }[],
  staffId: string
): Promise<ImportSummary> {
  const summary: ImportSummary = { created: 0, updated: 0, skipped: [] };

  const existingPaths = new Set(
    (await prisma.redirect.findMany({ select: { fromPath: true } })).map((r) => r.fromPath)
  );

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]!;
    const fromPath = normalisePath(rule.fromPath);
    const isUpdate = existingPaths.has(fromPath);

    const res = await saveRedirect({ ...rule, createdBy: staffId });
    if (!res.ok) {
      summary.skipped.push({ line: i + 1, raw: `${rule.fromPath} → ${rule.toPath}`, error: res.error });
      continue;
    }

    if (isUpdate) summary.updated += 1;
    else { summary.created += 1; existingPaths.add(fromPath); }
  }

  return summary;
}

export async function listRedirects(params: { q?: string; page?: number } = {}) {
  const page = Math.max(1, params.page ?? 1);
  const size = 50;
  const where: Prisma.RedirectWhereInput = params.q
    ? {
        OR: [
          { fromPath: { contains: params.q.toLowerCase() } },
          { toPath: { contains: params.q, mode: 'insensitive' } },
        ],
      }
    : {};

  const [items, total] = await Promise.all([
    prisma.redirect.findMany({
      where,
      orderBy: [{ hitCount: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * size,
      take: size,
    }),
    prisma.redirect.count({ where }),
  ]);

  return { items, total, page, totalPages: Math.max(1, Math.ceil(total / size)) };
}
