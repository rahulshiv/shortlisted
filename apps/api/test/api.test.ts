import { beforeAll, describe, expect, it } from "vitest";
import { signingKeyFromSeed, type Receipt } from "@shortlisted/receipts";
import { openDb, Repo } from "@shortlisted/store";
import { createContext, HeuristicResolver, inviteTenders, shortlist, type Context } from "@shortlisted/mcp-server";
import { createApi } from "../src/app.ts";

const SEED = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
let ctx: Context;
let api: ReturnType<typeof createApi>;
let now = new Date("2026-10-31T12:00:00Z");

beforeAll(async () => {
  const { db } = await openDb(":memory:");
  ctx = await createContext({ repo: new Repo(db), key: await signingKeyFromSeed(SEED), resolver: new HeuristicResolver(), clock: () => now, apiBaseUrl: "http://api.test" });
  api = createApi(ctx);
});

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  api.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("api", () => {
  it("publishes the issuer public key", async () => {
    const res = await api.request("/.well-known/shortlisted-pubkey");
    expect(await res.json()).toMatchObject({ alg: "ed25519", public_key: ctx.key.publicKey });
  });

  it("serves and verifies receipts", async () => {
    const { receipt } = await shortlist(ctx, { query: "wireless earbuds under $100 with good battery life" });
    const fetched = (await (await api.request(`/receipts/${receipt.id}`)).json()) as Receipt;
    expect(fetched.id).toBe(receipt.id);
    expect(await (await post("/verify", { receipt: fetched })).json()).toMatchObject({ status: "VALID" });
    expect(await (await post("/verify", fetched)).json()).toMatchObject({ status: "VALID" });
    expect(await (await post("/verify", { receipt: { ...fetched, query: { ...fetched.query, text: "edited" } } })).json()).toMatchObject({ status: "INVALID" });
    expect((await api.request("/receipts/rct_missing")).status).toBe(404);
  });

  it("gates tender offers behind x402", async () => {
    const t = await inviteTenders(ctx, { query: "earbuds under $100 with good battery life" }, 10);
    const offer = { brand: "Kestrel", name: "Kestrel One", attributes: { price: 89, battery_hours: 36, sound_quality: 8.5, comfort: 8 } };

    const unpaid = await post(`/tenders/${t.id}/offers`, offer);
    expect(unpaid.status).toBe(402);
    const reqs = (await unpaid.json()) as { x402Version: number; accepts: { resource: string }[] };
    expect(reqs.x402Version).toBe(1);
    expect(reqs.accepts[0]!.resource).toBe(`http://api.test/tenders/${t.id}/offers`);

    const paid = await post(`/tenders/${t.id}/offers`, offer, { "X-PAYMENT": "mock:kestrel" });
    expect(paid.status).toBe(201);
    expect(paid.headers.get("x-payment-response")).toBeTruthy();

    const invalid = await post(`/tenders/${t.id}/offers`, { brand: "X" }, { "X-PAYMENT": "mock:x" });
    expect(invalid.status).toBe(422);

    now = new Date(now.getTime() + 11 * 60_000);
    const closed = (await (await api.request(`/tenders/${t.id}`)).json()) as { status: string; receipt: Receipt };
    expect(closed.status).toBe("closed");
    expect(await (await post("/verify", { receipt: closed.receipt })).json()).toMatchObject({ status: "VALID" });
  });
});
