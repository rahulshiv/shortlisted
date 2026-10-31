import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { CATEGORIES } from "@shortlisted/catalog";
import { describeCategories, finalizeProposal, type CriteriaRequest, type CriteriaResolver, type ResolvedCriteria } from "./criteria.ts";

export const DEFAULT_MODEL = "claude-opus-5-5";

const ProposalSchema = z.object({
  category: z.enum(CATEGORIES.map((c) => c.id) as [string, ...string[]]),
  weights: z.array(z.object({ key: z.string(), weight: z.number() })),
  budget: z.number().nullable(),
  min: z.array(z.object({ key: z.string(), value: z.number() })),
  max: z.array(z.object({ key: z.string(), value: z.number() })),
});

const SYSTEM = `You translate a shopper's request into scoring criteria for a deterministic ranking engine.
You never rank products yourself. You only choose which attributes matter and how much.

Available categories and attributes (direction is fixed by the engine; you do not choose it):

${describeCategories()}

Output:
- category: the best-matching category id.
- weights: 2 to 5 attributes from that category with positive relative weights summing to about 1. Weight what the shopper said explicitly most heavily. Include price unless they say cost does not matter.
- budget: the maximum price in USD if stated or clearly implied, else null.
- min / max: hard requirements only (for example noise cancelling required means min anc = 1). Leave empty if none. Do not repeat the budget here.
Use only attribute keys listed for the chosen category.`;

/** Turns a query into criteria with Claude, validated by Zod and then by the category schema. */
export class LlmResolver implements CriteriaResolver {
  private readonly client: Anthropic;
  constructor(
    private readonly model = process.env.SHORTLISTED_MODEL ?? DEFAULT_MODEL,
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic();
  }

  async resolve(req: CriteriaRequest): Promise<ResolvedCriteria> {
    const user = [
      `Request: ${req.query}`,
      req.budget != null ? `Budget given by the caller: $${req.budget}` : null,
      req.category ? `Category is fixed: ${req.category}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const response = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
      output_config: { effort: "low", format: zodOutputFormat(ProposalSchema) },
      // Server-side fallback: if the model declines, the API reroutes instead of failing.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason === "refusal") throw new Error("model declined to produce criteria");
    const proposal = response.parsed_output;
    if (!proposal) throw new Error("model returned no parseable criteria");
    return finalizeProposal(proposal, req, `llm:${response.model}`);
  }
}

/** Tries the primary resolver, then the fallback, recording why. */
export class FallbackResolver implements CriteriaResolver {
  constructor(
    private readonly primary: CriteriaResolver,
    private readonly fallback: CriteriaResolver,
  ) {}

  async resolve(req: CriteriaRequest): Promise<ResolvedCriteria> {
    try {
      return await this.primary.resolve(req);
    } catch (err) {
      const res = await this.fallback.resolve(req);
      res.notes.push(`LLM unavailable (${(err as Error).message}); used keyword heuristic`);
      return res;
    }
  }
}
