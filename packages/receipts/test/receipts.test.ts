import { describe, expect, it } from "vitest";
import { canonicalJson } from "@shortlisted/core";
import {
  buildReceipt,
  buildReceiptBody,
  generateSeedHex,
  receiptBody,
  signingKeyFromSeed,
  verifyReceipt,
  type BuildReceiptInput,
  type Receipt,
} from "../src/index.ts";

// Fixed test seed so signatures are reproducible across runs.
const SEED = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";

const input: BuildReceiptInput = {
  query: { text: "wireless earbuds under $100 with good battery life", category: "earbuds", budget: 100, constraints: {} },
  criteria: {
    source: "test",
    items: [
      { key: "price", weight: 0.3, direction: "lower" },
      { key: "battery_hours", weight: 0.3, direction: "higher" },
      { key: "sound_quality", weight: 0.25, direction: "higher" },
      { key: "comfort", weight: 0.15, direction: "higher" },
    ],
  },
  offers: [
    { id: "eb-tempo-lite", name: "Tempo Lite", brand: "Tempo", attributes: { price: 49, battery_hours: 24, sound_quality: 7.2, comfort: 7.8 } },
    { id: "eb-novasound-air", name: "NovaSound Air", brand: "NovaSound", attributes: { price: 79, battery_hours: 32, sound_quality: 8.4, comfort: 8.6 } },
    { id: "eb-kestrel-one", name: "Kestrel One", brand: "Kestrel", attributes: { price: 89, battery_hours: 36, sound_quality: 8.5, comfort: 8.0 } },
    { id: "eb-acmebuds-pro", name: "AcmeBuds Pro", brand: "AcmeBuds", attributes: { price: 95, battery_hours: 30, sound_quality: 8.7, comfort: 8.1 } },
  ],
  filters: { max_price: 100 },
  catalogSource: "seed",
  payments: [
    { brand: "Kestrel", amount: "0.02", currency: "USDC", rail: "mock", reference: "mock_tx_kestrel" },
    { brand: "AcmeBuds", amount: "0.02", currency: "USDC", rail: "mock", reference: "mock_tx_acmebuds" },
  ],
  issuedAt: "2026-10-31T12:00:00.000Z",
};

async function freshReceipt(): Promise<{ receipt: Receipt; publicKey: string }> {
  const key = await signingKeyFromSeed(SEED);
  return { receipt: await buildReceipt(input, key), publicKey: key.publicKey };
}

/** Every path to a primitive value inside `value`. */
function leafPaths(value: unknown, prefix: (string | number)[] = []): (string | number)[][] {
  if (value !== null && typeof value === "object") {
    const entries = Array.isArray(value) ? value.map((v, i) => [i, v] as const) : Object.entries(value);
    return entries.flatMap(([k, v]) => leafPaths(v, [...prefix, k]));
  }
  return [prefix];
}

function mutateAt(obj: unknown, path: (string | number)[]): unknown {
  const clone = structuredClone(obj) as Record<string | number, unknown>;
  let cur = clone;
  for (const k of path.slice(0, -1)) cur = cur[k] as Record<string | number, unknown>;
  const last = path[path.length - 1]!;
  const v = cur[last];
  if (typeof v === "number") cur[last] = v + 1;
  else if (typeof v === "boolean") cur[last] = !v;
  else if (typeof v === "string") cur[last] = v.length > 0 ? (v[0] === "a" ? "b" : "a") + v.slice(1) : "x";
  else cur[last] = 0; // null
  return clone;
}

describe("receipts", () => {
  it("a fresh receipt verifies as VALID with every check passing", async () => {
    const { receipt, publicKey } = await freshReceipt();
    const result = await verifyReceipt(receipt, publicKey);
    expect(result.checks.filter((c) => !c.ok)).toEqual([]);
    expect(result.status).toBe("VALID");
    expect(receipt.id).toMatch(/^rct_/);
    expect(receipt.affected_ranking).toBe(false);
    expect(receipt.counterfactuals[0]?.summary).toMatch(/wins below/);
  });

  it("survives a JSON round trip", async () => {
    const { receipt, publicKey } = await freshReceipt();
    expect((await verifyReceipt(JSON.parse(JSON.stringify(receipt)), publicKey)).valid).toBe(true);
  });

  it("is not VALID without a pinned issuer key", async () => {
    const { receipt } = await freshReceipt();
    const result = await verifyReceipt(receipt);
    expect(result.valid).toBe(false);
    expect(result.checks.find((c) => c.name === "key pinned")?.ok).toBe(false);
    expect(result.checks.find((c) => c.name === "signature")?.ok).toBe(true);
  });

  it("fails with another issuer's key", async () => {
    const { receipt } = await freshReceipt();
    const other = await signingKeyFromSeed(generateSeedHex());
    expect((await verifyReceipt(receipt, other.publicKey)).valid).toBe(false);
  });

  it("rejects a forged receipt re-signed with another key", async () => {
    const { publicKey } = await freshReceipt();
    const forger = await signingKeyFromSeed(generateSeedHex());
    const forged = await buildReceipt(input, forger);
    expect((await verifyReceipt(forged, publicKey)).valid).toBe(false);
  });
});

describe("determinism", () => {
  it("same inputs produce a byte-identical body, id and signature", async () => {
    const key = await signingKeyFromSeed(SEED);
    const shuffled = { ...input, offers: [...input.offers].reverse(), payments: [...input.payments].reverse() };
    const a = await buildReceipt(input, key);
    const b = await buildReceipt(shuffled, key);
    expect(canonicalJson(receiptBody(a))).toBe(canonicalJson(receiptBody(b)));
    expect(a.id).toBe(b.id);
    expect(a.signature.value).toBe(b.signature.value);
  });

  it("a different timestamp gives a different id", async () => {
    const key = await signingKeyFromSeed(SEED);
    const a = buildReceiptBody(input, key.publicKey);
    const b = buildReceiptBody({ ...input, issuedAt: "2026-10-31T12:00:01.000Z" }, key.publicKey);
    expect(a.id).not.toBe(b.id);
  });
});

describe("fee independence in receipts", () => {
  it("changing who paid, or how much, never changes the scores", async () => {
    const key = await signingKeyFromSeed(SEED);
    const noFees = buildReceiptBody({ ...input, payments: [] }, key.publicKey);
    const bigFees = buildReceiptBody(
      { ...input, payments: input.offers.map((o) => ({ brand: o.brand, amount: "500.00", currency: "USDC", rail: "mock" as const, reference: o.id })) },
      key.publicKey,
    );
    expect(canonicalJson(bigFees.scores)).toBe(canonicalJson(noFees.scores));
    expect(canonicalJson(bigFees.counterfactuals)).toBe(canonicalJson(noFees.counterfactuals));
  });
});

describe("tamper detection", () => {
  it("changing any single field makes verification fail", async () => {
    const { receipt, publicKey } = await freshReceipt();
    const paths = leafPaths(receipt);
    expect(paths.length).toBeGreaterThan(50);
    const survivors: string[] = [];
    for (const path of paths) {
      const result = await verifyReceipt(mutateAt(receipt, path), publicKey);
      if (result.valid) survivors.push(path.join("."));
    }
    expect(survivors).toEqual([]);
  });

  it("adding, removing or reordering entries makes verification fail", async () => {
    const { receipt, publicKey } = await freshReceipt();
    const cases: Receipt[] = [
      { ...receipt, scores: receipt.scores.slice(0, -1) },
      { ...receipt, scores: [...receipt.scores].reverse() },
      { ...receipt, paid_to_be_considered: [] },
      { ...receipt, inputs: { ...receipt.inputs, offers: receipt.inputs.offers.slice(1) } },
      { ...receipt, counterfactuals: [] },
    ];
    for (const c of cases) expect((await verifyReceipt(c, publicKey)).valid).toBe(false);
    expect((await verifyReceipt({ ...receipt, extra: 1 }, publicKey)).valid).toBe(false);
  });

  it("a receipt whose scores disagree with its inputs fails even if re-signed by the issuer", async () => {
    // Guards against an issuer bug or a malicious issuer: the arithmetic must reproduce.
    const key = await signingKeyFromSeed(SEED);
    const body = buildReceiptBody(input, key.publicKey);
    const rigged = { ...body, scores: [...body.scores].reverse().map((s, i) => ({ ...s, rank: i + 1 })) };
    const { signReceipt } = await import("../src/index.ts");
    const signed = await signReceipt(rigged, key);
    const result = await verifyReceipt(signed, key.publicKey);
    expect(result.valid).toBe(false);
    expect(result.checks.find((c) => c.name === "ranking reproduces")?.ok).toBe(false);
  });
});
