import { z } from "zod";

export const RECEIPT_VERSION = "shortlisted.receipt/v0";

const CriterionSchema = z
  .object({
    key: z.string().min(1),
    weight: z.number().nonnegative(),
    direction: z.enum(["higher", "lower"]),
  })
  .strict();

const ScorableOfferSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    brand: z.string(),
    attributes: z.record(z.number()),
  })
  .strict();

const CounterfactualSchema = z
  .object({
    kind: z.literal("price_to_win"),
    offer_id: z.string(),
    name: z.string(),
    versus_offer_id: z.string(),
    current_price: z.number(),
    wins_below: z.number().nullable(),
    summary: z.string(),
  })
  .strict();

export const PaymentRecordSchema = z
  .object({
    brand: z.string(),
    /** Decimal string, e.g. "0.02", to avoid float drift in money. */
    amount: z.string().regex(/^\d+(\.\d+)?$/),
    currency: z.string(),
    rail: z.enum(["x402", "mock"]),
    /** Transaction hash or mock reference. */
    reference: z.string(),
  })
  .strict();

export const ReceiptBodySchema = z
  .object({
    version: z.literal(RECEIPT_VERSION),
    id: z.string().regex(/^rct_[1-9A-HJ-NP-Za-km-z]+$/),
    issued_at: z.string().datetime(),
    issuer: z.object({ name: z.string(), public_key: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
    query: z
      .object({
        text: z.string(),
        category: z.string(),
        budget: z.number().nullable(),
        constraints: z.record(z.union([z.string(), z.number(), z.boolean()])),
      })
      .strict(),
    criteria: z
      .object({
        /** Who produced the weights: an LLM (named), the keyword heuristic, or the caller. */
        source: z.string(),
        items: z.array(CriterionSchema).min(1),
      })
      .strict(),
    inputs: z
      .object({
        /** Candidate offers after hard filters, sorted by id. Exactly what the scorer saw. */
        offers: z.array(ScorableOfferSchema),
        offers_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
        /** Hard filters applied to the catalog before scoring, for the record. */
        filters: z.record(z.union([z.string(), z.number(), z.boolean()])),
        catalog_source: z.string(),
      })
      .strict(),
    scores: z.array(
      z
        .object({
          rank: z.number().int().positive(),
          offer_id: z.string(),
          name: z.string(),
          brand: z.string(),
          /** Weighted sum in [0, 1], rounded to 6 decimal places. */
          score: z.number(),
        })
        .strict(),
    ),
    paid_to_be_considered: z.array(PaymentRecordSchema),
    affected_ranking: z.literal(false),
    counterfactuals: z.array(CounterfactualSchema),
    scorer: z.object({ name: z.string(), version: z.string() }).strict(),
  })
  .strict();

export const SignatureSchema = z
  .object({
    alg: z.literal("ed25519"),
    public_key: z.string().regex(/^[0-9a-f]{64}$/),
    value: z.string().regex(/^[0-9a-f]{128}$/),
  })
  .strict();

export const ReceiptSchema = ReceiptBodySchema.extend({ signature: SignatureSchema }).strict();

export type ReceiptBody = z.infer<typeof ReceiptBodySchema>;
export type Receipt = z.infer<typeof ReceiptSchema>;
export type PaymentRecord = z.infer<typeof PaymentRecordSchema>;
