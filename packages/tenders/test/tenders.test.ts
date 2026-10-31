import { beforeEach, describe, expect, it } from "vitest";
import { canonicalJson } from "@shortlisted/core";
import { signingKeyFromSeed, verifyReceipt } from "@shortlisted/receipts";
import { openDb, Repo } from "@shortlisted/store";
import { MockPaymentVerifier, TenderError, Tenders, toAtomic, type TenderSpec } from "../src/index.ts";

const SEED = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const spec: TenderSpec = { query: "earbuds under $100 with long battery", category: "earbuds", budget: 100, constraints: {} };
const criteria = {
  source: "test",
  items: [
    { key: "price", weight: 0.5, direction: "lower" as const },
    { key: "battery_hours", weight: 0.5, direction: "higher" as const },
  ],
};
const t0 = new Date("2026-10-31T12:00:00Z");
const later = (min: number) => new Date(t0.getTime() + min * 60_000);

let tenders: Tenders;
let publicKey: string;

beforeEach(async () => {
  const { db } = await openDb(":memory:");
  const key = await signingKeyFromSeed(SEED);
  publicKey = key.publicKey;
  tenders = new Tenders({ repo: new Repo(db), key, verifier: new MockPaymentVerifier(), apiBaseUrl: "http://test" });
});

async function expectTenderError(p: Promise<unknown>, status: number) {
  await expect(p).rejects.toBeInstanceOf(TenderError);
  await p.catch((e: TenderError) => expect(e.status).toBe(status));
}

describe("tenders", () => {
  it("runs the full lifecycle and issues a VALID receipt on close", async () => {
    const t = await tenders.invite(spec, criteria, later(10), t0);
    expect(t.status).toBe("open");
    expect(t.submit_url).toBe(`http://test/tenders/${t.id}/offers`);

    await tenders.submitOffer(t.id, { brand: "Kestrel", name: "Kestrel One", attributes: { price: 89, battery_hours: 36 } }, "mock:kestrel", later(1));
    await tenders.submitOffer(t.id, { brand: "Tempo", name: "Tempo Max", attributes: { price: 85, battery_hours: 38 } }, "mock:tempo", later(2));

    const closed = await tenders.get(t.id, later(11));
    expect(closed.status).toBe("closed");
    expect(closed.offers_received).toBe(2);
    const receipt = closed.receipt!;
    expect(receipt.scores[0]!.name).toBe("Tempo Max");
    expect(receipt.paid_to_be_considered.map((p) => p.brand).sort()).toEqual(["Kestrel", "Tempo"]);
    expect((await verifyReceipt(receipt, publicKey)).status).toBe("VALID");
  });

  it("asks for payment with a 402 and x402 requirements", async () => {
    const t = await tenders.invite(spec, criteria, later(10), t0);
    const p = tenders.submitOffer(t.id, { brand: "Kestrel", name: "Kestrel One", attributes: { price: 89, battery_hours: 36 } }, undefined, later(1));
    await expectTenderError(p, 402);
    await p.catch((e: TenderError) => {
      expect(e.requirements?.scheme).toBe("exact");
      expect(e.requirements?.resource).toBe(`http://test/tenders/${t.id}/offers`);
    });
  });

  it("validates before charging and enforces the budget", async () => {
    const t = await tenders.invite(spec, criteria, later(10), t0);
    await expectTenderError(tenders.submitOffer(t.id, { brand: "X", name: "X", attributes: { price: 120, battery_hours: 40 } }, "mock:x", later(1)), 422);
    await expectTenderError(tenders.submitOffer(t.id, { brand: "X", name: "X", attributes: { price: 50 } }, "mock:x", later(1)), 422);
    await expectTenderError(tenders.submitOffer(t.id, { brand: "X", name: "X", attributes: { price: 50, battery_hours: 1, rgb: 1 } }, "mock:x", later(1)), 422);
  });

  it("rejects duplicate brands and late offers", async () => {
    const t = await tenders.invite(spec, criteria, later(10), t0);
    const offer = { brand: "Kestrel", name: "Kestrel One", attributes: { price: 89, battery_hours: 36 } };
    await tenders.submitOffer(t.id, offer, "mock:kestrel", later(1));
    await expectTenderError(tenders.submitOffer(t.id, offer, "mock:kestrel", later(2)), 409);
    await expectTenderError(tenders.submitOffer(t.id, { ...offer, brand: "Late" }, "mock:late", later(11)), 410);
  });

  it("scores tender offers independently of the toll paid", async () => {
    // Same two offers; in one tender the payments differ wildly. Scores must not move.
    const run = async (amounts: [string, string]) => {
      const { db, client } = await openDb(":memory:");
      const key = await signingKeyFromSeed(SEED);
      const repo = new Repo(db);
      const tt = new Tenders({ repo, key, verifier: new MockPaymentVerifier(), apiBaseUrl: "http://test" });
      const t = await tt.invite(spec, criteria, later(10), t0);
      await tt.submitOffer(t.id, { brand: "A", name: "Same", attributes: { price: 80, battery_hours: 30 } }, "mock:a", later(1));
      await tt.submitOffer(t.id, { brand: "B", name: "Same", attributes: { price: 80, battery_hours: 30 } }, "mock:b", later(1));
      // Tamper with stored payment amounts directly to simulate very different fees.
      await client.execute({ sql: "UPDATE tender_offers SET payment = json_set(payment, '$.amount', ?) WHERE brand = 'A'", args: [amounts[0]] });
      await client.execute({ sql: "UPDATE tender_offers SET payment = json_set(payment, '$.amount', ?) WHERE brand = 'B'", args: [amounts[1]] });
      return (await tt.close(t.id, later(11)))!;
    };
    const a = await run(["0.02", "0.02"]);
    const b = await run(["0.02", "900.00"]);
    expect(a.scores[0]!.score).toBe(a.scores[1]!.score);
    expect(canonicalJson(b.scores.map((s) => s.score))).toBe(canonicalJson(a.scores.map((s) => s.score)));
  });

  it("closes an empty tender without a receipt", async () => {
    const t = await tenders.invite(spec, criteria, later(1), t0);
    const closed = await tenders.get(t.id, later(2));
    expect(closed.status).toBe("closed");
    expect(closed.receipt).toBeNull();
  });
});

describe("toAtomic", () => {
  it("converts decimals without float error", () => {
    expect(toAtomic("0.02", 6)).toBe("20000");
    expect(toAtomic("1", 6)).toBe("1000000");
    expect(toAtomic("0.1234567", 6)).toBe("123456");
  });
});
