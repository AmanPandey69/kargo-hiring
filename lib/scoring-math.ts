import type { Band, Criterion, CriterionScore, RubricMeta } from "./types";

/** Weighted total = sum of (weight x score / 5). Range 20-100. Computed in code, never by the model. */
export function weightedTotal(criteria: Criterion[], scores: Record<string, CriterionScore>, maxScore = 5): number {
  const total = criteria.reduce((sum, c) => {
    const s = scores[c.id];
    if (!s) throw new Error(`missing score for ${c.id}`);
    return sum + (c.weight * s.score) / maxScore;
  }, 0);
  return Math.round(total * 100) / 100;
}

/** Bands from rubric.txt: >=75 shortlist, 55-74 review, <55 below. */
export function bandFor(total: number, bands: RubricMeta["bands"]): Band {
  if (total >= bands.shortlist) return "shortlist";
  if (total >= bands.review) return "review";
  return "below";
}

/** The two criteria contributing the most weighted points (ties broken by weight). */
export function topCriteria(criteria: Criterion[], scores: Record<string, CriterionScore>, n = 2): Criterion[] {
  return [...criteria]
    .sort((a, b) => b.weight * (scores[b.id]?.score ?? 0) - a.weight * (scores[a.id]?.score ?? 0) || b.weight - a.weight)
    .slice(0, n);
}

/** The criteria with the largest weighted gap to a perfect score. */
export function weakestCriteria(criteria: Criterion[], scores: Record<string, CriterionScore>, n = 3): Criterion[] {
  const gap = (c: Criterion) => c.weight * (5 - (scores[c.id]?.score ?? 1));
  return [...criteria].sort((a, b) => gap(b) - gap(a)).slice(0, n);
}
