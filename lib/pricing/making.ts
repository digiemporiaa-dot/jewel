import type { MakingChargeScope, MakingChargeType } from '@prisma/client';
import type { MakingChargeInput } from '@/lib/pricing';

/**
 * A making-charge rule candidate (subset of the MakingChargeRule row needed to
 * resolve which one applies to a product/variant).
 */
export interface MakingRuleCandidate {
  id: string;
  scope: MakingChargeScope;
  type: MakingChargeType;
  value: string;
  minCharge: string | null;
  priority: number;
  isActive: boolean;
  metalId: string | null;
  purityId: string | null;
  categoryId: string | null;
}

export interface MakingContext {
  categoryId: string | null;
  metalId: string | null;
  purityId: string | null;
}

// Specificity ranking — higher wins. Mirrors the brief's resolution order:
// Variant → Category+Metal+Purity → Category+Metal → Metal → Global.
const SCOPE_RANK: Record<MakingChargeScope, number> = {
  VARIANT: 5,
  CATEGORY_METAL_PURITY: 4,
  CATEGORY_METAL: 3,
  METAL: 2,
  GLOBAL: 1,
};

function ruleMatches(rule: MakingRuleCandidate, ctx: MakingContext): boolean {
  if (!rule.isActive) return false;
  switch (rule.scope) {
    case 'GLOBAL':
      return true;
    case 'METAL':
      return !!rule.metalId && rule.metalId === ctx.metalId;
    case 'CATEGORY_METAL':
      return (
        !!rule.metalId && rule.metalId === ctx.metalId &&
        !!rule.categoryId && rule.categoryId === ctx.categoryId
      );
    case 'CATEGORY_METAL_PURITY':
      return (
        !!rule.metalId && rule.metalId === ctx.metalId &&
        !!rule.categoryId && rule.categoryId === ctx.categoryId &&
        !!rule.purityId && rule.purityId === ctx.purityId
      );
    case 'VARIANT':
      // Variant-scoped rules are applied by explicit assignment, not by context.
      return false;
    default:
      return false;
  }
}

/**
 * Pick the most specific applicable making-charge rule for a context.
 * Ties on specificity are broken by the higher `priority`.
 * Returns null when nothing (not even a GLOBAL rule) applies.
 */
export function pickMakingRule(
  rules: MakingRuleCandidate[],
  ctx: MakingContext
): MakingRuleCandidate | null {
  const applicable = rules.filter((r) => ruleMatches(r, ctx));
  if (applicable.length === 0) return null;
  applicable.sort((a, b) => {
    const rank = SCOPE_RANK[b.scope] - SCOPE_RANK[a.scope];
    if (rank !== 0) return rank;
    return b.priority - a.priority;
  });
  return applicable[0] ?? null;
}

export function toMakingChargeInput(rule: MakingRuleCandidate | null): MakingChargeInput | null {
  if (!rule) return null;
  return { type: rule.type, value: rule.value, minCharge: rule.minCharge };
}
