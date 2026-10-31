import { counterfactuals, scoreOffers, type Criterion } from "@shortlisted/core";
import { directionFor, toScorableOffer } from "@shortlisted/catalog";
import { buildReceipt, verifyReceipt, type Receipt, type VerifyResult } from "@shortlisted/receipts";
import type { TenderView } from "@shortlisted/tenders";
import type { Context } from "./context.ts";
import { finalizeProposal, type ResolvedCriteria } from "./criteria.ts";
import { HeuristicResolver } from "./heuristic.ts";

export interface ShortlistInput {
  query: string;
  budget?: number | null;
  /** Hard filters as "max.<attr>" / "min.<attr>" → number, e.g. { "min.anc": 1 }. */
  constraints?: Record<string, number>;
  /** Category id. Used with `weights`; inferred from the query when omitted. */
  category?: string;
  /**
   * Criteria chosen by the calling agent (attribute → relative weight). When set, the
   * server's own resolver is skipped; the weights get the same schema check as any proposal.
   */
  weights?: Record<string, number>;
}

export interface ShortlistResult {
  shortlist: { rank: number; offer_id: string; name: string; brand: string; score: number; price: number | null; url: string | null }[];
  receipt: Receipt;
  notes: string[];
}

export class UserError extends Error {}

function boundsFrom(constraints: Record<string, number> = {}) {
  const max: Record<string, number> = {};
  const min: Record<string, number> = {};
  for (const [k, v] of Object.entries(constraints)) {
    const [kind, attr] = k.split(".");
    if (!attr || (kind !== "max" && kind !== "min")) throw new UserError(`constraint "${k}" must look like "max.<attribute>" or "min.<attribute>"`);
    (kind === "max" ? max : min)[attr] = v;
  }
  return { max, min };
}

/** Weights from the MCP client. Category and budget fall back to the heuristic's parse of the query. */
async function clientCriteria(input: ShortlistInput, weights: Record<string, number>): Promise<ResolvedCriteria> {
  if (Object.keys(weights).length === 0) throw new UserError("weights must name at least one attribute");
  const req = { query: input.query, budget: input.budget ?? null, ...(input.category ? { category: input.category } : {}) };
  const parsed = await new HeuristicResolver().resolve(req);
  return finalizeProposal(
    { category: parsed.category, weights: Object.entries(weights).map(([key, weight]) => ({ key, weight })), budget: parsed.max.price ?? null, min: [], max: [] },
    req,
    "client",
  );
}

/**
 * The shortlist pipeline. The model (if any) only produces criteria. Everything after
 * that is deterministic: hard filters, scoring, counterfactuals, signing.
 */
export async function shortlist(ctx: Context, input: ShortlistInput): Promise<ShortlistResult> {
  const resolved = input.weights
    ? await clientCriteria(input, input.weights)
    : await ctx.resolver.resolve({ query: input.query, budget: input.budget ?? null, ...(input.category ? { category: input.category } : {}) });
  const extra = boundsFrom(input.constraints);
  const max = { ...resolved.max, ...extra.max };
  const min = { ...resolved.min, ...extra.min };

  const candidates = await ctx.catalog.search({ category: resolved.category, max, min });
  if (candidates.length === 0) throw new UserError(`no ${resolved.category} match those constraints (max: ${JSON.stringify(max)}, min: ${JSON.stringify(min)})`);
  const offers = candidates.map(toScorableOffer);

  // Payments come from the toll ledger, a separate path from the offers above.
  const brands = new Set(offers.map((o) => o.brand));
  const payments = (await ctx.repo.listTolls(resolved.category)).filter((p) => brands.has(p.brand));

  const receipt = await buildReceipt(
    {
      query: { text: input.query, category: resolved.category, budget: max.price ?? null, constraints: input.constraints ?? {} },
      criteria: { source: resolved.source, items: resolved.criteria },
      offers,
      filters: {
        ...Object.fromEntries(Object.entries(max).map(([k, v]) => [`max.${k}`, v])),
        ...Object.fromEntries(Object.entries(min).map(([k, v]) => [`min.${k}`, v])),
      },
      catalogSource: ctx.catalog.name,
      payments,
      issuedAt: ctx.clock().toISOString(),
    },
    ctx.key,
  );
  await ctx.repo.saveReceipt(receipt);

  const byId = new Map(candidates.map((c) => [c.id, c]));
  return {
    shortlist: receipt.scores.slice(0, 5).map((s) => ({
      ...s,
      price: byId.get(s.offer_id)?.attributes.price?.value ?? null,
      url: byId.get(s.offer_id)?.url ?? null,
    })),
    receipt,
    notes: resolved.notes,
  };
}

export async function verify(ctx: Context, receipt: unknown, publicKey?: string): Promise<VerifyResult> {
  const r = typeof receipt === "string" ? safeJson(receipt) : receipt;
  return verifyReceipt(r, publicKey ?? ctx.key.publicKey);
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export interface ExplainResult {
  receipt_id: string;
  original_criteria: Criterion[];
  new_criteria: Criterion[];
  winner_changed: boolean;
  rows: { offer_id: string; name: string; old_rank: number; new_rank: number; old_score: number; new_score: number }[];
  counterfactuals: ReturnType<typeof counterfactuals>;
  note: string;
}

/** Re-scores a stored receipt's inputs with different weights. A what-if, not a new receipt. */
export async function explain(ctx: Context, receiptId: string, newWeights: Record<string, number>): Promise<ExplainResult> {
  const receipt = await ctx.repo.getReceipt(receiptId);
  if (!receipt) throw new UserError(`receipt ${receiptId} not found`);
  const original = receipt.criteria.items;

  const merged = new Map(original.map((c) => [c.key, { ...c }]));
  for (const [key, weight] of Object.entries(newWeights)) {
    if (!Number.isFinite(weight) || weight < 0) throw new UserError(`weight for ${key} must be a non-negative number`);
    const direction = merged.get(key)?.direction ?? directionFor(receipt.query.category, key);
    if (!direction) throw new UserError(`unknown attribute "${key}" for ${receipt.query.category}`);
    if (!receipt.inputs.offers.some((o) => o.attributes[key] !== undefined)) throw new UserError(`no offer in this receipt has "${key}"`);
    merged.set(key, { key, weight, direction });
  }
  const next = [...merged.values()].filter((c) => c.weight > 0);
  if (next.length === 0) throw new UserError("at least one weight must be positive");

  const rescored = scoreOffers(next, receipt.inputs.offers);
  const oldRank = new Map(receipt.scores.map((s) => [s.offer_id, s]));
  return {
    receipt_id: receipt.id,
    original_criteria: original,
    new_criteria: next,
    winner_changed: rescored[0]!.offer_id !== receipt.scores[0]!.offer_id,
    rows: rescored.map((r) => ({
      offer_id: r.offer_id,
      name: r.name,
      old_rank: oldRank.get(r.offer_id)!.rank,
      new_rank: r.rank,
      old_score: oldRank.get(r.offer_id)!.score,
      new_score: Math.round(r.score * 1e6) / 1e6,
    })),
    counterfactuals: counterfactuals(next, receipt.inputs.offers),
    note: "What-if analysis on the receipt's signed inputs. The original receipt is unchanged.",
  };
}

export interface InviteInput {
  query: string;
  category?: string;
  budget?: number | null;
  constraints?: Record<string, number>;
}

export async function inviteTenders(ctx: Context, spec: InviteInput, deadlineMinutes: number): Promise<TenderView> {
  if (!(deadlineMinutes > 0 && deadlineMinutes <= 7 * 24 * 60)) throw new UserError("deadline_minutes must be between 1 and 10080");
  const resolved = await ctx.resolver.resolve({ query: spec.query, budget: spec.budget ?? null, ...(spec.category ? { category: spec.category } : {}) });
  const now = ctx.clock();
  return ctx.tenders.invite(
    {
      query: spec.query,
      category: resolved.category,
      budget: resolved.max.price ?? null,
      constraints: {
        ...Object.fromEntries(Object.entries(resolved.min).map(([k, v]) => [`min.${k}`, v])),
        ...Object.fromEntries(Object.entries(resolved.max).filter(([k]) => k !== "price").map(([k, v]) => [`max.${k}`, v])),
        ...(spec.constraints ?? {}),
      },
    },
    { source: resolved.source, items: resolved.criteria },
    new Date(now.getTime() + deadlineMinutes * 60_000),
    now,
  );
}

export async function getTender(ctx: Context, id: string): Promise<TenderView> {
  return ctx.tenders.get(id, ctx.clock());
}
