// End-to-end demo: earbuds query → criteria → deterministic ranking → signed receipt → verification.
import { canonicalJson } from "@shortlisted/core";
import { verifyReceipt } from "@shortlisted/receipts";
import { createContext, explain, formatExplain, formatReceiptCard, formatVerify, shortlist } from "@shortlisted/mcp-server";

const QUERY = process.argv.slice(2).join(" ") || "wireless earbuds under $100 with good battery life";
const hr = (title: string) => console.log(`\n── ${title} ${"─".repeat(Math.max(0, 66 - title.length))}`);

const ctx = await createContext();
hr("request");
console.log(QUERY);

const res = await shortlist(ctx, { query: QUERY });
hr("criteria");
console.log(`source: ${res.receipt.criteria.source}${res.notes.length ? `  (${res.notes.join("; ")})` : ""}`);
for (const c of res.receipt.criteria.items) console.log(`  ${c.key.padEnd(20)} ${c.weight.toFixed(2)}  ${c.direction} is better`);

hr("receipt card");
const v = await verifyReceipt(res.receipt, ctx.key.publicKey);
console.log(formatReceiptCard(res.receipt, v.status));

hr("full receipt (JSON)");
console.log(JSON.stringify(res.receipt, null, 2));

hr("verify_receipt");
console.log(formatVerify(v));

hr("tamper test: swap the top two scores");
const s = res.receipt.scores;
const tampered = { ...res.receipt, scores: [{ ...s[1]!, rank: 1 }, { ...s[0]!, rank: 2 }, ...s.slice(2)] };
const tv = await verifyReceipt(tampered, ctx.key.publicKey);
console.log(formatVerify(tv).split("\n").filter((l) => !l.includes("✓")).join("\n"));

hr("determinism: same inputs, same clock");
const fixed = new Date(res.receipt.issued_at);
const ctx2 = await createContext({ clock: () => fixed });
const again = await shortlist({ ...ctx2, resolver: ctx.resolver }, { query: QUERY });
const { signature: _a, ...b1 } = res.receipt;
const { signature: _b, ...b2 } = again.receipt;
console.log(canonicalJson(b1) === canonicalJson(b2) ? "byte-identical receipt body ✓" : "bodies differ (criteria came from a non-deterministic LLM call)");

hr("explain: what if sound mattered most?");
console.log(formatExplain(await explain(ctx, res.receipt.id, { price: 0.1, sound_quality: 0.6 })));

hr("next");
console.log(`verify in the browser: http://localhost:5173/?id=${res.receipt.id}`);
console.log(`or: curl -s localhost:8787/receipts/${res.receipt.id} | curl -s -X POST localhost:8787/verify -H 'content-type: application/json' -d @-`);
