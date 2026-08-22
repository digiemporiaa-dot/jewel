/**
 * Redirect rules.
 *
 * A redirect table is one of the few pieces of shop configuration that can take
 * the whole site down: a rule pointing a path at itself is an infinite loop, and
 * a browser meeting one shows `ERR_TOO_MANY_REDIRECTS` rather than a page. So
 * the interesting logic here is all refusal — what cannot be saved, and why.
 *
 * Pure and dependency-free, so every rule is testable without a database or a
 * request.
 */

/** Only these two. 307/308 exist but nothing here needs to preserve a method. */
export const STATUS_CODES = [301, 302] as const;
export type RedirectStatus = (typeof STATUS_CODES)[number];

export type RedirectRule = {
  fromPath: string;
  toPath: string;
  statusCode: RedirectStatus;
};

/**
 * Canonical form of a path, for storage and for lookup.
 *
 * Both sides go through this so a rule typed as `/Old-Ring/` matches a request
 * for `/old-ring`. Case is folded because a shopper following a link from print
 * or a QR code frequently gets it wrong, and matching case-sensitively would
 * turn a working redirect into a 404 for exactly those people.
 *
 * The query string is dropped: rules match paths, and preserving an incoming
 * query is the resolver's job, not the rule's.
 */
export function normalisePath(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '') return '';

  // Take the path only, whether given a full URL or a bare path.
  let path = trimmed;
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return '';
    }
  }

  path = path.split('?')[0]?.split('#')[0] ?? '';
  if (path === '') return '';
  if (!path.startsWith('/')) path = `/${path}`;

  // Collapse repeated slashes — `//old//ring` and `/old/ring` are one page, and
  // a leading `//` would otherwise read as protocol-relative.
  path = path.replace(/\/{2,}/g, '/');
  path = path.replace(/\/+$/, '');

  return (path || '/').toLowerCase();
}

/** Where a redirect may point. Off-site targets are allowed but flagged. */
export type TargetKind = 'internal' | 'external' | 'invalid';

export function classifyTarget(input: string): TargetKind {
  const value = input.trim();
  if (value === '') return 'invalid';

  // Protocol-relative — an off-site URL wearing a path's clothing.
  if (value.startsWith('//')) return 'external';
  if (value.startsWith('/')) return 'internal';

  if (/^https?:\/\//i.test(value)) {
    try {
      new URL(value);
      return 'external';
    } catch {
      return 'invalid';
    }
  }

  // Anything else — `javascript:`, `data:`, a bare word — is not a destination
  // this will ever send a shopper to.
  return 'invalid';
}

export type RuleCheck = { ok: true } | { ok: false; error: string };

/**
 * Can this rule be saved at all?
 *
 * Checked before the table is consulted, so the errors are about the rule in
 * isolation: a self-redirect, an unusable target, a status code that is not one
 * of the two that make sense.
 */
export function checkRule(rule: {
  fromPath: string;
  toPath: string;
  statusCode: number;
}): RuleCheck {
  const from = normalisePath(rule.fromPath);
  if (from === '') return { ok: false, error: 'Enter the old path, like /old-ring.' };
  if (from === '/') {
    return { ok: false, error: 'The home page cannot be redirected — that would take the whole site down.' };
  }

  const kind = classifyTarget(rule.toPath);
  if (kind === 'invalid') {
    return { ok: false, error: 'The destination must be a path like /new-ring, or a full https:// address.' };
  }

  // A rule pointing at itself is an infinite loop the moment it is saved.
  if (kind === 'internal' && normalisePath(rule.toPath) === from) {
    return { ok: false, error: 'That sends the page to itself, which would loop forever.' };
  }

  if (!STATUS_CODES.includes(rule.statusCode as RedirectStatus)) {
    return { ok: false, error: 'Use 301 for a permanent move or 302 for a temporary one.' };
  }

  // Redirecting away from a path the shop still serves is legal but almost
  // always a mistake, so it is caught where the caller knows the live routes;
  // see `conflictsWithLivePath`.
  return { ok: true };
}

/**
 * Paths the application itself owns. A redirect on one of these would shadow a
 * working page — the checkout, most alarmingly.
 */
const RESERVED_PREFIXES = ['/api', '/admin', '/_next', '/checkout', '/cart', '/my-account'];

export function isReservedPath(path: string): boolean {
  const normalised = normalisePath(path);
  return RESERVED_PREFIXES.some((p) => normalised === p || normalised.startsWith(`${p}/`));
}

// ── Loops and chains ─────────────────────────────────────────────────────────

export type ChainResult =
  | { kind: 'ok'; finalTarget: string; hops: number }
  | { kind: 'loop'; path: string[] }
  | { kind: 'too-long'; path: string[] };

/** Anything past this is a configuration mistake, not a redirect. */
export const MAX_HOPS = 5;

/**
 * Follow a rule to where it actually lands.
 *
 * Chains are not rejected outright — an operator who renames a product twice has
 * legitimately created A→B→C, and refusing the second rename would be worse than
 * the extra hop. Instead the chain is *followed* so it can be flattened to A→C
 * on save, which is what search engines want anyway: each extra hop loses a
 * little ranking and adds a round trip on a mobile connection.
 *
 * What is rejected is a loop, and a chain long enough to be a mistake.
 */
export function followChain(
  from: string,
  rules: Map<string, string>,
  maxHops = MAX_HOPS
): ChainResult {
  const start = normalisePath(from);
  const seen = [start];
  let current = start;

  for (let hop = 0; hop < maxHops; hop++) {
    const next = rules.get(current);
    if (next === undefined) {
      return { kind: 'ok', finalTarget: hop === 0 ? start : current, hops: hop };
    }

    // An off-site target ends the chain — nothing here can follow it further.
    if (classifyTarget(next) === 'external') {
      return { kind: 'ok', finalTarget: next, hops: hop + 1 };
    }

    const target = normalisePath(next);
    if (seen.includes(target)) return { kind: 'loop', path: [...seen, target] };

    seen.push(target);
    current = target;
  }

  return { kind: 'too-long', path: seen };
}

/**
 * Would adding this rule create a loop?
 *
 * The check that matters, and the one a naive implementation misses: A→B exists,
 * and somebody now adds B→A. Neither rule points at itself, so a self-check
 * passes both, and the site starts bouncing between two URLs forever.
 */
export function wouldLoop(
  rule: { fromPath: string; toPath: string },
  existing: Map<string, string>
): boolean {
  const from = normalisePath(rule.fromPath);
  if (classifyTarget(rule.toPath) === 'external') return false;

  const to = normalisePath(rule.toPath);
  if (to === from) return true;

  // Walk forward from the proposed target through the rules already stored. If
  // the walk comes back to `from`, the new rule closes a cycle.
  const withNew = new Map(existing);
  withNew.set(from, to);
  return followChain(from, withNew).kind === 'loop';
}

/**
 * Collapse a chain so the rule points where it actually ends up.
 *
 * Returns the target unchanged when there is nothing to flatten, so a caller can
 * apply this unconditionally.
 */
export function flattenTarget(
  rule: { fromPath: string; toPath: string },
  existing: Map<string, string>
): string {
  if (classifyTarget(rule.toPath) === 'external') return rule.toPath.trim();

  const to = normalisePath(rule.toPath);
  const result = followChain(to, existing);
  return result.kind === 'ok' && result.hops > 0 ? result.finalTarget : to;
}

/**
 * Rules that would now point somewhere shorter.
 *
 * Adding B→C makes an existing A→B into a two-hop chain. Rather than leaving it,
 * the caller re-points A straight at C. Returns the updates to apply.
 */
export function restitchInbound(
  added: { fromPath: string; toPath: string },
  existing: Map<string, string>
): { fromPath: string; toPath: string }[] {
  const from = normalisePath(added.fromPath);
  const to = classifyTarget(added.toPath) === 'external' ? added.toPath.trim() : normalisePath(added.toPath);

  const updates: { fromPath: string; toPath: string }[] = [];
  for (const [ruleFrom, ruleTo] of existing) {
    if (ruleFrom === from) continue;
    if (classifyTarget(ruleTo) === 'external') continue;
    if (normalisePath(ruleTo) === from) updates.push({ fromPath: ruleFrom, toPath: to });
  }
  return updates;
}

// ── CSV import ───────────────────────────────────────────────────────────────

export type ParsedRow =
  | { ok: true; line: number; rule: RedirectRule }
  | { ok: false; line: number; raw: string; error: string };

/**
 * Parse a pasted CSV of redirects.
 *
 * Deliberately forgiving about shape — operators paste exports from Shopify,
 * from a spreadsheet, or from a list somebody emailed them — and deliberately
 * strict about content. Every row is reported, good or bad, so an import of two
 * hundred rules does not silently drop the nine that were malformed.
 */
export function parseRedirectCsv(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/);
  const rows: ParsedRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const line = i + 1;
    if (raw.trim() === '') continue;

    const cells = splitCsvLine(raw);
    const first = cells[0]?.trim() ?? '';

    // Skip a header row rather than reporting it as an error.
    if (i === 0 && /^(from|old|source|redirect\s*from|path)/i.test(first)) continue;

    if (cells.length < 2) {
      rows.push({ ok: false, line, raw, error: 'Needs at least two columns: old path, new path.' });
      continue;
    }

    const statusRaw = (cells[2] ?? '').trim();
    const statusCode = statusRaw === '' ? 301 : Number(statusRaw);
    const check = checkRule({ fromPath: cells[0] ?? '', toPath: cells[1] ?? '', statusCode });
    if (!check.ok) {
      rows.push({ ok: false, line, raw, error: check.error });
      continue;
    }

    rows.push({
      ok: true,
      line,
      rule: {
        fromPath: normalisePath(cells[0] ?? ''),
        toPath: classifyTarget(cells[1] ?? '') === 'external'
          ? (cells[1] ?? '').trim()
          : normalisePath(cells[1] ?? ''),
        statusCode: statusCode as RedirectStatus,
      },
    });
  }

  return rows;
}

/** Split one CSV line, honouring double-quoted cells. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cell += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',' || ch === '\t') {
      cells.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells;
}
