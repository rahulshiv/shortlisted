import { CATEGORIES } from "@shortlisted/catalog";
import { finalizeProposal, type CriteriaRequest, type CriteriaResolver, type ResolvedCriteria } from "./criteria.ts";

/** Keyword → attribute. Checked in order; a query can hit several. */
const KEYWORDS: [RegExp, string][] = [
  [/batter(y|ies)|all[- ]day|long[- ]lasting|charge/i, "battery_hours"],
  [/sound|audio|bass|music|hi-?fi/i, "sound_quality"],
  [/comfort|fit|ergonomic/i, "comfort"],
  [/noise[- ]cancel|\banc\b|quiet/i, "anc"],
  [/water|sweat|gym|workout|running|waterproof/i, "water_resistance_ipx"],
  [/gaming|latency|lag/i, "latency_ms"],
  [/fast|performance|powerful|cpu|coding|compile|video edit/i, "cpu_score"],
  [/\bram\b|memory|multitask/i, "ram_gb"],
  [/storage|ssd|space/i, "storage_gb"],
  [/bright|outdoor|sunlight|display/i, "display_nits"],
  [/build|durable|sturdy|premium/i, "build_quality"],
];
const LIGHT = /light(weight)?|portable|travel|carry/i;

/** Background priorities per category, used alongside whatever the query emphasizes. */
const DEFAULTS: Record<string, Record<string, number>> = {
  earbuds: { sound_quality: 2.5, comfort: 1.5 },
  laptops: { cpu_score: 2, battery_hours: 1.5, build_quality: 1.5, weight_kg: 1 },
};

/**
 * Deterministic, offline stand-in for the LLM. Used when ANTHROPIC_API_KEY is unset or the
 * model call fails. Emphasized attributes get weight 3, price gets 3, category defaults fill in.
 */
export class HeuristicResolver implements CriteriaResolver {
  async resolve(req: CriteriaRequest): Promise<ResolvedCriteria> {
    const q = req.query;
    const category =
      req.category ??
      CATEGORIES.find((c) => c.keywords.some((k) => new RegExp(`\\b${k}\\b`, "i").test(q)))?.id ??
      CATEGORIES[0]!.id;
    const attrs = new Set(CATEGORIES.find((c) => c.id === category)!.attributes.map((a) => a.key));

    const weights = new Map<string, number>([["price", 3]]);
    for (const [k, w] of Object.entries(DEFAULTS[category] ?? {})) weights.set(k, w);
    for (const [re, key] of KEYWORDS) if (re.test(q) && attrs.has(key)) weights.set(key, 3);
    if (LIGHT.test(q)) for (const key of ["weight_g", "weight_kg"]) if (attrs.has(key)) weights.set(key, 3);

    const budgetMatch = q.match(/(?:under|below|less than|max(?:imum)?|up to|<)\s*\$?\s*(\d+(?:[.,]\d+)?)\s*(k)?/i);
    const budget = budgetMatch ? parseFloat(budgetMatch[1]!.replace(",", "")) * (budgetMatch[2] ? 1000 : 1) : null;
    const min: { key: string; value: number }[] = [];
    if (/noise[- ]cancel|\banc\b/i.test(q) && attrs.has("anc")) min.push({ key: "anc", value: 1 });

    return finalizeProposal(
      { category, weights: [...weights.entries()].map(([key, weight]) => ({ key, weight })), budget, min, max: [] },
      req,
      "heuristic",
    );
  }
}
