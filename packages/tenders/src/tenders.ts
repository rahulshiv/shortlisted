import { z } from "zod";
import { sha256Hex, type Criterion, type ScorableOffer } from "@shortlisted/core";
import { getCategory } from "@shortlisted/catalog";
import { buildReceipt, type PaymentRecord, type Receipt, type SigningKey } from "@shortlisted/receipts";
import type { Repo, TenderRow } from "@shortlisted/store";
import type { PaymentRequirements, PaymentVerifier, TollPrice } from "./payment.ts";

export const DEFAULT_TOLL: TollPrice = { amount: "0.02", currency: "USDC" };

export const TenderSpecSchema = z
  .object({
    query: z.string().min(1),
    category: z.string(),
    budget: z.number().positive().nullable().default(null),
    /** Hard filters, e.g. { "min.anc": 1 }. Offers failing them are not scored. */
    constraints: z.record(z.number()).default({}),
  })
  .strict();
export type TenderSpec = z.infer<typeof TenderSpecSchema>;

export const OfferSubmissionSchema = z
  .object({
    brand: z.string().min(1).max(80),
    name: z.string().min(1).max(120),
    url: z.string().url().optional(),
    attributes: z.record(z.number().finite()),
  })
  .strict();
export type OfferSubmission = z.infer<typeof OfferSubmissionSchema>;

export interface TenderView {
  id: string;
  status: "open" | "closed";
  spec: TenderSpec;
  criteria: { source: string; items: Criterion[] };
  deadline: string;
  toll: TollPrice;
  offers_received: number;
  submit_url: string;
  receipt: Receipt | null;
}

export class TenderError extends Error {
  constructor(
    readonly status: 400 | 402 | 404 | 409 | 410 | 422,
    message: string,
    readonly requirements?: PaymentRequirements,
  ) {
    super(message);
  }
}

export interface TenderDeps {
  repo: Repo;
  key: SigningKey;
  verifier: PaymentVerifier;
  /** Public base URL of the HTTP API, used in submit URLs and x402 resources. */
  apiBaseUrl: string;
  toll?: TollPrice;
}

const submitPath = (id: string) => `/tenders/${id}/offers`;

/** Splits constraint keys of the form "max.price" / "min.anc" into catalog-style bounds. */
export function boundsFromConstraints(spec: TenderSpec): { max: Record<string, number>; min: Record<string, number> } {
  const max: Record<string, number> = {};
  const min: Record<string, number> = {};
  if (spec.budget !== null) max.price = spec.budget;
  for (const [k, v] of Object.entries(spec.constraints)) {
    const [kind, attr] = k.split(".");
    if (!attr) continue;
    if (kind === "max") max[attr] = Math.min(max[attr] ?? Infinity, v);
    if (kind === "min") min[attr] = Math.max(min[attr] ?? -Infinity, v);
  }
  return { max, min };
}

export class Tenders {
  private readonly toll: TollPrice;
  constructor(private readonly deps: TenderDeps) {
    this.toll = deps.toll ?? DEFAULT_TOLL;
  }

  /** Opens a request for quote. Criteria are fixed at creation so every brand competes on the same rules. */
  async invite(spec: TenderSpec, criteria: { source: string; items: Criterion[] }, deadline: Date, now: Date): Promise<TenderView> {
    const category = getCategory(spec.category);
    if (!category) throw new TenderError(400, `unknown category "${spec.category}"`);
    if (deadline <= now) throw new TenderError(400, "deadline must be in the future");
    const createdAt = now.toISOString();
    const id = `tnd_${sha256Hex(`${createdAt}|${JSON.stringify(spec)}|${Math.random()}`).slice(0, 12)}`;
    await this.deps.repo.insertTender({
      id,
      spec,
      criteria,
      status: "open",
      deadline: deadline.toISOString(),
      tollAmount: this.toll.amount,
      tollCurrency: this.toll.currency,
      createdAt,
    });
    return this.get(id, now);
  }

  /** Returns the tender, closing and scoring it first if its deadline has passed. */
  async get(id: string, now: Date): Promise<TenderView> {
    let row = await this.requireTender(id);
    if (row.status === "open" && new Date(row.deadline) <= now) {
      await this.close(id, now);
      row = await this.requireTender(id);
    }
    return this.view(row);
  }

  /**
   * A brand's offer. Validation happens before payment, so a malformed offer is never charged.
   * With no valid X-PAYMENT header this throws a 402 carrying the x402 payment requirements.
   */
  async submitOffer(id: string, body: unknown, paymentHeader: string | undefined, now: Date): Promise<{ offer_id: string; payment: PaymentRecord }> {
    const row = await this.requireTender(id);
    if (row.status !== "open" || new Date(row.deadline) <= now) throw new TenderError(410, "tender is closed");

    const parsed = OfferSubmissionSchema.safeParse(body);
    if (!parsed.success) throw new TenderError(422, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const sub = parsed.data;
    const spec = row.spec as TenderSpec;
    const category = getCategory(spec.category)!;
    const known = new Set(category.attributes.map((a) => a.key));
    const unknown = Object.keys(sub.attributes).filter((k) => !known.has(k));
    if (unknown.length) throw new TenderError(422, `unknown attributes for ${spec.category}: ${unknown.join(", ")}`);
    const criteria = row.criteria as { items: Criterion[] };
    const missing = criteria.items.map((c) => c.key).filter((k) => sub.attributes[k] === undefined);
    if (missing.length) throw new TenderError(422, `missing attributes required by the tender criteria: ${missing.join(", ")}`);
    const { max, min } = boundsFromConstraints(spec);
    for (const [k, bound] of Object.entries(max)) {
      const v = sub.attributes[k];
      if (v === undefined || v > bound) throw new TenderError(422, `${k} must be at most ${bound}`);
    }
    for (const [k, bound] of Object.entries(min)) {
      const v = sub.attributes[k];
      if (v === undefined || v < bound) throw new TenderError(422, `${k} must be at least ${bound}`);
    }
    if (await this.deps.repo.findTenderOffer(id, sub.brand)) throw new TenderError(409, `${sub.brand} already submitted an offer`);

    const price = { amount: row.tollAmount, currency: row.tollCurrency };
    const requirements = this.deps.verifier.requirements(
      `${this.deps.apiBaseUrl}${submitPath(id)}`,
      price,
      `Flat toll to be considered in tender ${id}. Does not affect ranking.`,
    );
    const verdict = await this.deps.verifier.verify(paymentHeader, requirements, sub.brand, price);
    if (!verdict.ok) throw new TenderError(402, verdict.reason, requirements);

    const offerId = `${id}:${sha256Hex(sub.brand).slice(0, 10)}`;
    const scorable: ScorableOffer = { id: offerId, name: sub.name, brand: sub.brand, attributes: sub.attributes };
    await this.deps.repo.insertTenderOffer({
      id: offerId,
      tenderId: id,
      brand: sub.brand,
      offer: { ...scorable, url: sub.url ?? null, source: { type: "brand_submission", retrieved_at: now.toISOString() } },
      payment: verdict.payment,
      createdAt: now.toISOString(),
    });
    return { offer_id: offerId, payment: verdict.payment };
  }

  /** Closes the tender and scores the offers with the same scorer as every other shortlist. */
  async close(id: string, now: Date): Promise<Receipt | null> {
    const row = await this.requireTender(id);
    if (row.status === "closed") return row.receiptId ? this.deps.repo.getReceipt(row.receiptId) : null;
    const spec = row.spec as TenderSpec;
    const criteria = row.criteria as { source: string; items: Criterion[] };
    const offerRows = await this.deps.repo.listTenderOffers(id);

    let receipt: Receipt | null = null;
    if (offerRows.length > 0) {
      // Offers and payments come from separate columns and go down separate paths.
      const offers: ScorableOffer[] = offerRows.map((r) => {
        const o = r.offer as ScorableOffer;
        return { id: o.id, name: o.name, brand: o.brand, attributes: o.attributes };
      });
      const payments = offerRows.map((r) => r.payment as PaymentRecord);
      const { max, min } = boundsFromConstraints(spec);
      receipt = await buildReceipt(
        {
          query: { text: spec.query, category: spec.category, budget: spec.budget, constraints: spec.constraints },
          criteria,
          offers,
          filters: { ...prefixKeys("max", max), ...prefixKeys("min", min) },
          catalogSource: `tender:${id} (brand-submitted attributes)`,
          payments,
          issuedAt: now.toISOString(),
        },
        this.deps.key,
      );
      await this.deps.repo.saveReceipt(receipt);
    }
    await this.deps.repo.closeTender(id, receipt?.id ?? null, now.toISOString());
    return receipt;
  }

  private async requireTender(id: string): Promise<TenderRow> {
    const row = await this.deps.repo.getTender(id);
    if (!row) throw new TenderError(404, `tender ${id} not found`);
    return row;
  }

  private async view(row: TenderRow): Promise<TenderView> {
    const offers = await this.deps.repo.listTenderOffers(row.id);
    return {
      id: row.id,
      status: row.status,
      spec: row.spec as TenderSpec,
      criteria: row.criteria as TenderView["criteria"],
      deadline: row.deadline,
      toll: { amount: row.tollAmount, currency: row.tollCurrency },
      offers_received: offers.length,
      submit_url: `${this.deps.apiBaseUrl}${submitPath(row.id)}`,
      receipt: row.receiptId ? await this.deps.repo.getReceipt(row.receiptId) : null,
    };
  }
}

function prefixKeys(prefix: string, obj: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [`${prefix}.${k}`, v]));
}
