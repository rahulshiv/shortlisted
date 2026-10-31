import {
  SCORER_NAME,
  SCORER_VERSION,
  canonicalJson,
  counterfactuals,
  hashCanonical,
  scoreOffers,
  toScorable,
  type Criterion,
  type ScorableOffer,
} from "@shortlisted/core";
import { sha256 } from "@noble/hashes/sha256";
import { utf8ToBytes } from "@noble/hashes/utils";
import { base58 } from "./base58.ts";
import { signBytes, type SigningKey } from "./keys.ts";
import { RECEIPT_VERSION, type PaymentRecord, type Receipt, type ReceiptBody } from "./schema.ts";

export interface BuildReceiptInput {
  query: { text: string; category: string; budget: number | null; constraints: Record<string, string | number | boolean> };
  criteria: { source: string; items: Criterion[] };
  offers: readonly ScorableOffer[];
  filters: Record<string, string | number | boolean>;
  catalogSource: string;
  /** Kept apart from `offers` on purpose: this list never reaches the scorer. */
  payments: readonly PaymentRecord[];
  /** Injected so the same inputs give the same receipt. */
  issuedAt: string;
}

export const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Inputs as stored in the receipt: fee-free, sorted by id. */
export function canonicalOffers(offers: readonly ScorableOffer[]): ScorableOffer[] {
  return offers.map(toScorable).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function sortPayments(payments: readonly PaymentRecord[]): PaymentRecord[] {
  return [...payments].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
}

/** The exact bytes that are signed: a domain-separation prefix plus canonical JSON of the body. */
export function signingPayload(body: ReceiptBody): Uint8Array {
  return utf8ToBytes(`${RECEIPT_VERSION}\n${canonicalJson(body)}`);
}

/** Content-derived id: hash of the body with the id field blanked. */
export function receiptId(body: Omit<ReceiptBody, "id">): string {
  const digest = sha256(utf8ToBytes(canonicalJson({ ...body, id: "" })));
  return `rct_${base58(digest.slice(0, 12))}`;
}

export function buildReceiptBody(input: BuildReceiptInput, publicKey: string): ReceiptBody {
  const offers = canonicalOffers(input.offers);
  const ranked = scoreOffers(input.criteria.items, offers);
  const withoutId: Omit<ReceiptBody, "id"> = {
    version: RECEIPT_VERSION,
    issued_at: input.issuedAt,
    issuer: { name: "shortlisted.tech", public_key: publicKey },
    query: input.query,
    criteria: { source: input.criteria.source, items: input.criteria.items.map((c) => ({ key: c.key, weight: c.weight, direction: c.direction })) },
    inputs: { offers, offers_hash: hashCanonical(offers), filters: input.filters, catalog_source: input.catalogSource },
    scores: ranked.map((r) => ({ rank: r.rank, offer_id: r.offer_id, name: r.name, brand: r.brand, score: round6(r.score) })),
    paid_to_be_considered: sortPayments(input.payments),
    affected_ranking: false,
    counterfactuals: counterfactuals(input.criteria.items, offers),
    scorer: { name: SCORER_NAME, version: SCORER_VERSION },
  };
  return { ...withoutId, id: receiptId(withoutId) } as ReceiptBody;
}

export async function signReceipt(body: ReceiptBody, key: SigningKey): Promise<Receipt> {
  const value = await signBytes(signingPayload(body), key);
  return { ...body, signature: { alg: "ed25519", public_key: key.publicKey, value } };
}

export async function buildReceipt(input: BuildReceiptInput, key: SigningKey): Promise<Receipt> {
  return signReceipt(buildReceiptBody(input, key.publicKey), key);
}

/** Splits a receipt into the signed body and its signature. */
export function receiptBody(receipt: Receipt): ReceiptBody {
  const { signature: _signature, ...body } = receipt;
  return body;
}
