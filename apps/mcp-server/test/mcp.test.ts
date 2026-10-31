import { beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { signingKeyFromSeed, verifyReceipt, type Receipt } from "@shortlisted/receipts";
import { openDb, Repo } from "@shortlisted/store";
import { createContext, createMcpServer, explain, finalizeProposal, HeuristicResolver, shortlist, type Context } from "../src/index.ts";

const SEED = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const QUERY = "wireless earbuds under $100 with good battery life";

let ctx: Context;
beforeAll(async () => {
  const { db } = await openDb(":memory:");
  const repo = new Repo(db);
  for (const brand of ["AcmeBuds", "Kestrel"]) {
    await repo.recordToll("earbuds", { brand, amount: "0.02", currency: "USDC", rail: "mock", reference: `mock_${brand}` }, "2026-10-31T00:00:00Z");
  }
  ctx = await createContext({
    repo,
    key: await signingKeyFromSeed(SEED),
    resolver: new HeuristicResolver(),
    clock: () => new Date("2026-10-31T12:00:00Z"),
  });
});

describe("criteria", () => {
  it("heuristic maps the earbuds query to the expected weights and budget", async () => {
    const r = await new HeuristicResolver().resolve({ query: QUERY });
    expect(r.category).toBe("earbuds");
    expect(r.max).toEqual({ price: 100 });
    expect(Object.fromEntries(r.criteria.map((c) => [c.key, c.weight]))).toEqual({ price: 0.3, battery_hours: 0.3, sound_quality: 0.25, comfort: 0.15 });
  });

  it("takes directions from the category schema, never from the model, and drops unknown keys", () => {
    const r = finalizeProposal(
      { category: "earbuds", weights: [{ key: "price", weight: 2 }, { key: "vibes", weight: 5 }, { key: "weight_g", weight: 2 }], budget: 80, min: [], max: [] },
      { query: "x" },
      "llm:test",
    );
    expect(r.criteria).toEqual([
      { key: "price", weight: 0.5, direction: "lower" },
      { key: "weight_g", weight: 0.5, direction: "lower" },
    ]);
    expect(r.notes.join()).toMatch(/vibes/);
  });
});

describe("shortlist service", () => {
  it("returns a ranked shortlist and a VALID receipt", async () => {
    const res = await shortlist(ctx, { query: QUERY });
    expect(res.shortlist.length).toBeGreaterThan(2);
    expect(res.shortlist.every((s) => (s.price ?? 0) <= 100)).toBe(true);
    expect(res.receipt.paid_to_be_considered.map((p) => p.brand)).toEqual(["AcmeBuds", "Kestrel"]);
    expect((await verifyReceipt(res.receipt, ctx.key.publicKey)).status).toBe("VALID");
  });

  it("uses weights chosen by the client, checked against the schema, and records the source", async () => {
    const res = await shortlist(ctx, { query: QUERY, weights: { battery_hours: 3, price: 1, vibes: 9 } });
    expect(res.receipt.criteria).toEqual({
      source: "client",
      items: [
        { key: "battery_hours", weight: 0.75, direction: "higher" },
        { key: "price", weight: 0.25, direction: "lower" },
      ],
    });
    expect(res.receipt.query).toMatchObject({ category: "earbuds", budget: 100 }); // budget still parsed from the query
    expect(res.notes.join()).toMatch(/vibes/);
    expect((await verifyReceipt(res.receipt, ctx.key.publicKey)).status).toBe("VALID");
  });

  it("explain shows what changes under different weights", async () => {
    const res = await shortlist(ctx, { query: QUERY });
    const e = await explain(ctx, res.receipt.id, { price: 0, sound_quality: 1 });
    expect(e.new_criteria.find((c) => c.key === "price")).toBeUndefined();
    expect(e.rows[0]!.name).toBe("AcmeBuds Pro"); // best sound under $100 in the seed data
    expect(e.rows.length).toBe(res.receipt.scores.length);
  });
});

describe("MCP tools over a real client", () => {
  it("lists tools and runs shortlist → verify_receipt end to end", async () => {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await createMcpServer(ctx).connect(serverT);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(clientT);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["explain", "get_tender", "invite_tenders", "shortlist", "verify_receipt"]);

    const sl = await client.callTool({ name: "shortlist", arguments: { query: QUERY } });
    const receipt = (sl.structuredContent as { receipt: Receipt }).receipt;
    const v = await client.callTool({ name: "verify_receipt", arguments: { receipt } });
    expect((v.structuredContent as { status: string }).status).toBe("VALID");
    const byId = await client.callTool({ name: "verify_receipt", arguments: { receipt_id: receipt.id } });
    expect((byId.structuredContent as { status: string }).status).toBe("VALID");
    expect((await client.callTool({ name: "verify_receipt", arguments: { receipt_id: "rct_nope" } })).isError).toBe(true);

    const tampered = { ...receipt, scores: [...receipt.scores].reverse() };
    const bad = await client.callTool({ name: "verify_receipt", arguments: { receipt: JSON.stringify(tampered) } });
    expect((bad.structuredContent as { status: string }).status).toBe("INVALID");

    const t = await client.callTool({ name: "invite_tenders", arguments: { spec: { query: "laptop under $1500 with long battery" }, deadline_minutes: 30 } });
    const tenderId = (t.structuredContent as { id: string }).id;
    const g = await client.callTool({ name: "get_tender", arguments: { tender_id: tenderId } });
    expect((g.structuredContent as { status: string; spec: { category: string } }).spec.category).toBe("laptops");

    const err = await client.callTool({ name: "explain", arguments: { receipt_id: "rct_nope", new_weights: { price: 1 } } });
    expect(err.isError).toBe(true);
  });
});
