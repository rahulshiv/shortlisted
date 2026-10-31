import { SCORER_NAME, SCORER_VERSION, canonicalJson, counterfactuals, hashCanonical, scoreOffers } from "@shortlisted/core";
import { receiptBody, receiptId, round6, signingPayload, canonicalOffers } from "./build.ts";
import { verifyBytes } from "./keys.ts";
import { ReceiptSchema, type Receipt } from "./schema.ts";

export interface VerifyCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface VerifyResult {
  valid: boolean;
  status: "VALID" | "INVALID";
  receipt_id: string | null;
  checks: VerifyCheck[];
}

/**
 * Verifies a receipt using only the receipt and the issuer's public key.
 * Beyond the signature, it re-runs the scorer on the embedded inputs and checks
 * the ranking, scores and counterfactuals match what was signed.
 *
 * If `publicKey` is omitted, the key embedded in the receipt is used and a failing
 * "key pinned" check is reported: that proves integrity, not who issued it.
 */
export async function verifyReceipt(input: unknown, publicKey?: string): Promise<VerifyResult> {
  const checks: VerifyCheck[] = [];
  const add = (name: string, ok: boolean, detail?: string) => checks.push(detail ? { name, ok, detail } : { name, ok });
  const done = (id: string | null): VerifyResult => {
    const valid = checks.every((c) => c.ok);
    return { valid, status: valid ? "VALID" : "INVALID", receipt_id: id, checks };
  };

  const parsed = ReceiptSchema.safeParse(input);
  if (!parsed.success) {
    add("schema", false, parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "));
    return done(typeof (input as { id?: unknown })?.id === "string" ? (input as { id: string }).id : null);
  }
  add("schema", true);
  const receipt: Receipt = parsed.data;
  const body = receiptBody(receipt);

  const key = (publicKey ?? receipt.signature.public_key).toLowerCase();
  add("key pinned", publicKey !== undefined, publicKey === undefined ? "no issuer key supplied; used the key embedded in the receipt" : undefined);
  add("key matches receipt", key === receipt.signature.public_key && key === receipt.issuer.public_key);
  add("signature", await verifyBytes(receipt.signature.value, signingPayload(body), key));

  const { id: _id, ...withoutId } = body;
  add("id is content hash", receiptId(withoutId) === receipt.id);

  const offers = receipt.inputs.offers;
  add("inputs in canonical order", canonicalJson(canonicalOffers(offers)) === canonicalJson(offers));
  add("offers hash", hashCanonical(offers) === receipt.inputs.offers_hash);
  add("fee did not affect ranking", receipt.affected_ranking === false);
  add("scorer version", receipt.scorer.name === SCORER_NAME && receipt.scorer.version === SCORER_VERSION, `${receipt.scorer.name}@${receipt.scorer.version}`);

  try {
    const rerun = scoreOffers(receipt.criteria.items, offers).map((r) => ({
      rank: r.rank,
      offer_id: r.offer_id,
      name: r.name,
      brand: r.brand,
      score: round6(r.score),
    }));
    add("ranking reproduces", canonicalJson(rerun) === canonicalJson(receipt.scores));
    add("counterfactuals reproduce", canonicalJson(counterfactuals(receipt.criteria.items, offers)) === canonicalJson(receipt.counterfactuals));
  } catch (err) {
    add("ranking reproduces", false, (err as Error).message);
  }

  return done(receipt.id);
}
