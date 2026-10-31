import type { Criterion } from "@shortlisted/core";
import { CATEGORIES, getCategory, type CategorySchema } from "@shortlisted/catalog";

/** What the scorer and catalog need from a free-text request. */
export interface ResolvedCriteria {
  category: string;
  criteria: Criterion[];
  /** Hard filters: inclusive bounds per attribute. */
  max: Record<string, number>;
  min: Record<string, number>;
  /** "llm:<model>" or "heuristic". Recorded in the receipt. */
  source: string;
  notes: string[];
}

export interface CriteriaRequest {
  query: string;
  budget?: number | null;
  category?: string;
}

export interface CriteriaResolver {
  resolve(req: CriteriaRequest): Promise<ResolvedCriteria>;
}

/** Proposal from any resolver, before it is checked against the category schema. */
export interface CriteriaProposal {
  category: string;
  weights: { key: string; weight: number }[];
  budget: number | null;
  min: { key: string; value: number }[];
  max: { key: string; value: number }[];
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/**
 * Checks a proposal against the category schema and turns it into scorer input.
 * Directions always come from the schema. Unknown keys are dropped, weights normalized.
 */
export function finalizeProposal(p: CriteriaProposal, req: CriteriaRequest, source: string): ResolvedCriteria {
  const notes: string[] = [];
  const category = getCategory(req.category ?? p.category) ?? CATEGORIES[0]!;
  if (category.id !== (req.category ?? p.category)) notes.push(`unknown category "${req.category ?? p.category}", used ${category.id}`);
  const spec = new Map(category.attributes.map((a) => [a.key, a]));

  const merged = new Map<string, number>();
  for (const w of p.weights) {
    if (!spec.has(w.key)) {
      notes.push(`ignored unknown attribute "${w.key}"`);
      continue;
    }
    if (!Number.isFinite(w.weight) || w.weight <= 0) continue;
    merged.set(w.key, (merged.get(w.key) ?? 0) + w.weight);
  }
  if (merged.size === 0) {
    notes.push("no usable criteria, fell back to price");
    merged.set("price", 1);
  }
  const total = [...merged.values()].reduce((s, w) => s + w, 0);
  const criteria: Criterion[] = [...merged.entries()]
    .map(([key, w]) => ({ key, weight: round4(w / total), direction: spec.get(key)!.direction }))
    .sort((a, b) => b.weight - a.weight || (a.key < b.key ? -1 : 1));

  const max: Record<string, number> = {};
  const min: Record<string, number> = {};
  const budget = req.budget ?? p.budget;
  if (budget != null && budget > 0) max.price = budget;
  for (const b of p.max) if (spec.has(b.key) && Number.isFinite(b.value)) max[b.key] = Math.min(max[b.key] ?? Infinity, b.value);
  for (const b of p.min) if (spec.has(b.key) && Number.isFinite(b.value)) min[b.key] = Math.max(min[b.key] ?? -Infinity, b.value);

  return { category: category.id, criteria, max, min, source, notes };
}

export function describeCategories(categories: CategorySchema[] = CATEGORIES): string {
  return categories
    .map((c) => `${c.id} (${c.label}):\n${c.attributes.map((a) => `  - ${a.key} [${a.direction} is better, ${a.unit}]: ${a.description}`).join("\n")}`)
    .join("\n\n");
}
