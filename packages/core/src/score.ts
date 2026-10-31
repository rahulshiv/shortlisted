import type { Contribution, Criterion, ScorableOffer, ScoredOffer } from "./types.ts";

/** Copies only the fields the scorer is allowed to read, so a cast can't smuggle a fee in. */
export function toScorable(offer: ScorableOffer): ScorableOffer {
  const attributes: Record<string, number> = {};
  for (const key of Object.keys(offer.attributes).sort()) {
    const v = offer.attributes[key];
    if (typeof v === "number" && Number.isFinite(v)) attributes[key] = v;
  }
  return { id: offer.id, name: offer.name, brand: offer.brand, attributes };
}

/** Sorted by key and weights rescaled to sum to 1. Throws on invalid input. */
export function normalizeCriteria(criteria: readonly Criterion[]): Criterion[] {
  if (criteria.length === 0) throw new Error("scoreOffers: at least one criterion is required");
  const seen = new Set<string>();
  for (const c of criteria) {
    if (seen.has(c.key)) throw new Error(`scoreOffers: duplicate criterion "${c.key}"`);
    seen.add(c.key);
    if (!Number.isFinite(c.weight) || c.weight < 0) throw new Error(`scoreOffers: invalid weight for "${c.key}"`);
    if (c.direction !== "higher" && c.direction !== "lower") throw new Error(`scoreOffers: invalid direction for "${c.key}"`);
  }
  const total = criteria.reduce((s, c) => s + c.weight, 0);
  if (total <= 0) throw new Error("scoreOffers: weights must sum to more than 0");
  return [...criteria]
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((c) => ({ key: c.key, weight: c.weight / total, direction: c.direction }));
}

/**
 * Deterministic weighted-sum ranking.
 *
 * For each criterion, values are min-max normalized across the offers to [0, 1],
 * flipped when lower is better. If every offer has the same value, all get 1.
 * An offer missing an attribute gets 0 for it. The score is the weighted sum.
 * Ties break by offer id ascending.
 */
export function scoreOffers(criteria: readonly Criterion[], offers: readonly ScorableOffer[]): ScoredOffer[] {
  const crit = normalizeCriteria(criteria);
  const clean = offers.map(toScorable);
  const ids = new Set<string>();
  for (const o of clean) {
    if (ids.has(o.id)) throw new Error(`scoreOffers: duplicate offer id "${o.id}"`);
    ids.add(o.id);
  }

  const ranges = new Map<string, { min: number; max: number }>();
  for (const c of crit) {
    let min = Infinity;
    let max = -Infinity;
    for (const o of clean) {
      const v = o.attributes[c.key];
      if (v === undefined) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    ranges.set(c.key, { min, max });
  }

  const scored = clean.map((o) => {
    const contributions: Contribution[] = crit.map((c) => {
      const raw = o.attributes[c.key];
      const { min, max } = ranges.get(c.key)!;
      let normalized: number;
      if (raw === undefined) normalized = 0;
      else if (max === min) normalized = 1;
      else normalized = c.direction === "higher" ? (raw - min) / (max - min) : (max - raw) / (max - min);
      return { key: c.key, raw: raw ?? null, normalized, weight: c.weight, points: c.weight * normalized };
    });
    // Sum in fixed (key-sorted) order so floating-point results are reproducible.
    let score = 0;
    for (const x of contributions) score += x.points;
    return { offer: o, score, contributions };
  });

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.offer.id < b.offer.id ? -1 : a.offer.id > b.offer.id ? 1 : 0;
  });

  return scored.map((s, i) => ({
    rank: i + 1,
    offer_id: s.offer.id,
    name: s.offer.name,
    brand: s.offer.brand,
    score: s.score,
    contributions: s.contributions,
  }));
}
