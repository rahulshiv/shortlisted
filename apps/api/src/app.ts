import { Hono } from "hono";
import { cors } from "hono/cors";
import { verifyReceipt } from "@shortlisted/receipts";
import { paymentRequiredBody, TenderError } from "@shortlisted/tenders";
import type { Context } from "@shortlisted/mcp-server";

/** Public HTTP API. Uses web-standard Request/Response only, so the same app can run on Workers. */
export function createApi(ctx: Context) {
  const app = new Hono();
  app.use("*", cors({ origin: "*", allowHeaders: ["content-type", "x-payment"], exposeHeaders: ["x-payment-response"] }));

  app.get("/", (c) =>
    c.json({
      name: "shortlisted-api",
      endpoints: ["GET /.well-known/shortlisted-pubkey", "POST /verify", "GET /receipts/:id", "GET /tenders/:id", "POST /tenders/:id/offers"],
    }),
  );

  app.get("/.well-known/shortlisted-pubkey", (c) =>
    c.json({ issuer: "shortlisted.tech", alg: "ed25519", public_key: ctx.key.publicKey, encoding: "hex" }),
  );

  app.post("/verify", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "expected JSON { receipt, public_key? }" }, 400);
    const { receipt, public_key } = body as { receipt?: unknown; public_key?: string };
    // Accept a bare receipt too.
    const target = receipt ?? body;
    return c.json(await verifyReceipt(target, public_key ?? ctx.key.publicKey));
  });

  app.get("/receipts/:id", async (c) => {
    const receipt = await ctx.repo.getReceipt(c.req.param("id"));
    return receipt ? c.json(receipt) : c.json({ error: "not found" }, 404);
  });

  app.get("/tenders/:id", async (c) => {
    try {
      return c.json(await ctx.tenders.get(c.req.param("id"), ctx.clock()));
    } catch (err) {
      if (err instanceof TenderError) return c.json({ error: err.message }, err.status);
      throw err;
    }
  });

  /** Brands submit offers here. Gated by x402: without a valid X-PAYMENT header the response is 402. */
  app.post("/tenders/:id/offers", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    try {
      const res = await ctx.tenders.submitOffer(c.req.param("id"), body, c.req.header("x-payment"), ctx.clock());
      c.header("X-PAYMENT-RESPONSE", btoa(JSON.stringify({ success: true, transaction: res.payment.reference, rail: res.payment.rail })));
      return c.json({ ...res, note: "Offer accepted. The toll admits it to the tender and does not affect its score." }, 201);
    } catch (err) {
      if (err instanceof TenderError) {
        if (err.status === 402 && err.requirements) return c.json(paymentRequiredBody(err.requirements, err.message), 402);
        return c.json({ error: err.message }, err.status);
      }
      throw err;
    }
  });

  return app;
}
