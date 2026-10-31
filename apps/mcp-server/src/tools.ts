import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { TenderError } from "@shortlisted/tenders";
import type { Context } from "./context.ts";
import { describeCategories } from "./criteria.ts";
import { formatExplain, formatReceiptCard, formatShortlist, formatVerify } from "./format.ts";
import { UserError, explain, getTender, inviteTenders, shortlist, verify } from "./service.ts";

const json = (v: unknown) => JSON.stringify(v, null, 2);
const constraintsSchema = z
  .record(z.number())
  .optional()
  .describe('Hard filters as "max.<attribute>" or "min.<attribute>" to a number, e.g. {"min.anc": 1, "max.weight_g": 5}.');

async function run(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UserError || err instanceof TenderError) return { isError: true, content: [{ type: "text", text: err.message }] };
    throw err;
  }
}

export function createMcpServer(ctx: Context): McpServer {
  const server = new McpServer({ name: "shortlisted", version: "0.1.0" });

  server.registerTool(
    "shortlist",
    {
      title: "Shortlist products",
      description:
        "Call before buying something. Turns a shopping request into weighted criteria, ranks catalog products with deterministic arithmetic, and returns the shortlist plus a signed decision receipt. Fees paid by brands are listed in the receipt and never affect the ranking.\n\n" +
        "You may choose the criteria yourself by passing `category` and `weights` (relative importance per attribute; they are normalized). Directions come from the schema below, unknown attributes are dropped, and the receipt records the source as \"client\". Without `weights`, the server derives criteria from the query.\n\n" +
        describeCategories(),
      inputSchema: {
        query: z.string().min(3).describe('What the user wants, e.g. "wireless earbuds under $100 with good battery life".'),
        budget: z.number().positive().optional().describe("Maximum price in USD, if known."),
        constraints: constraintsSchema,
        category: z.string().optional().describe('Category id, e.g. "earbuds". Inferred from the query if omitted.'),
        weights: z
          .record(z.number().positive())
          .optional()
          .describe('Your criteria: attribute → relative weight, e.g. {"battery_hours": 3, "price": 3, "sound_quality": 2}.'),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    (args) =>
      run(async () => {
        const res = await shortlist(ctx, args);
        return {
          content: [
            { type: "text", text: formatShortlist(res) },
            { type: "text", text: json(res.receipt) },
          ],
          structuredContent: { shortlist: res.shortlist, receipt: res.receipt, notes: res.notes },
        };
      }),
  );

  server.registerTool(
    "verify_receipt",
    {
      title: "Verify a decision receipt",
      description:
        "Checks a Shortlisted receipt: Ed25519 signature, content hash, and a full re-run of the scorer on the embedded inputs. Returns VALID or INVALID with each check. For a receipt this server issued, pass receipt_id: retyping the JSON by hand changes bytes and makes it fail.",
      inputSchema: {
        receipt_id: z.string().optional().describe("rct_… id of a receipt this server issued."),
        receipt: z.union([z.record(z.unknown()), z.string()]).optional().describe("A receipt object or JSON string from elsewhere, copied exactly."),
        public_key: z.string().optional().describe("Issuer public key (hex). Defaults to this server's key."),
      },
      annotations: { readOnlyHint: true },
    },
    ({ receipt_id, receipt, public_key }) =>
      run(async () => {
        if (!receipt_id && receipt === undefined) throw new UserError("pass receipt_id or receipt");
        const target = receipt_id ? await ctx.repo.getReceipt(receipt_id) : receipt;
        if (!target) throw new UserError(`receipt ${receipt_id} not found`);
        const v = await verify(ctx, target, public_key);
        return { content: [{ type: "text", text: formatVerify(v) }], structuredContent: { ...v } };
      }),
  );

  server.registerTool(
    "explain",
    {
      title: "What-if re-scoring",
      description:
        "Re-scores a past receipt's exact inputs with different weights to show what would change. Weights you pass override the originals; 0 removes a criterion; new attributes from the same category can be added.",
      inputSchema: {
        receipt_id: z.string().describe("rct_… id from a shortlist call."),
        new_weights: z.record(z.number().nonnegative()).describe('e.g. {"price": 0.1, "sound_quality": 0.6}'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ receipt_id, new_weights }) =>
      run(async () => {
        const e = await explain(ctx, receipt_id, new_weights);
        return { content: [{ type: "text", text: formatExplain(e) }], structuredContent: { ...e } };
      }),
  );

  server.registerTool(
    "invite_tenders",
    {
      title: "Invite brands to tender",
      description:
        "Opens a request for quote. Brands submit offers over HTTP (paying a flat x402 toll to be considered) until the deadline; then offers are scored with the same deterministic scorer and a receipt is issued. Use get_tender to check status.",
      inputSchema: {
        spec: z
          .object({
            query: z.string().min(3),
            category: z.string().optional(),
            budget: z.number().positive().optional(),
            constraints: constraintsSchema,
          })
          .describe("What is wanted. Criteria are derived from the query and fixed when the tender opens."),
        deadline_minutes: z.number().int().positive().max(10080),
      },
    },
    ({ spec, deadline_minutes }) =>
      run(async () => {
        const t = await inviteTenders(ctx, spec, deadline_minutes);
        const example = `curl -X POST ${t.submit_url} -H 'content-type: application/json' -H 'X-PAYMENT: mock:yourbrand' -d '{"brand":"YourBrand","name":"Product","attributes":{${t.criteria.items.map((c) => `"${c.key}":0`).join(",")}}}'`;
        return {
          content: [
            {
              type: "text",
              text: `Tender ${t.id} is open until ${t.deadline}.\ncriteria: ${t.criteria.items.map((c) => `${c.key} ${c.weight}`).join(", ")}\ntoll: ${t.toll.amount} ${t.toll.currency} (flat, does not affect ranking)\nbrands submit to: ${t.submit_url}\n\nexample:\n${example}`,
            },
          ],
          structuredContent: { ...t },
        };
      }),
  );

  server.registerTool(
    "get_tender",
    {
      title: "Get tender status",
      description: "Returns a tender's status. Once the deadline passes it is closed and scored, and the signed receipt is included.",
      inputSchema: { tender_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ tender_id }) =>
      run(async () => {
        const t = await getTender(ctx, tender_id);
        const summary =
          t.status === "open"
            ? `Tender ${t.id} is open until ${t.deadline}. ${t.offers_received} offer(s) so far.`
            : t.receipt
              ? `Tender ${t.id} closed with ${t.offers_received} offer(s).\n\n${formatReceiptCard(t.receipt)}`
              : `Tender ${t.id} closed with no offers.`;
        return {
          content: [{ type: "text", text: summary }, ...(t.receipt ? [{ type: "text" as const, text: json(t.receipt) }] : [])],
          structuredContent: { ...t },
        };
      }),
  );

  return server;
}
