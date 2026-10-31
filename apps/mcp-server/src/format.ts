import type { Receipt, VerifyResult } from "@shortlisted/receipts";
import type { ExplainResult, ShortlistResult } from "./service.ts";

const pct = (n: number) => n.toFixed(2);
/** Displayed on a 0-10 scale, like the receipt card. */
export const display10 = (score: number) => (score * 10).toFixed(2);

export function formatReceiptCard(r: Receipt, status?: VerifyResult["status"]): string {
  const lines = [
    `DECISION RECEIPT  ${r.id}`,
    `query:      ${r.query.text}`,
    `criteria:   ${r.criteria.items.map((c) => `${c.key} ${pct(c.weight)}`).join(", ")}  (${r.criteria.source})`,
    `shortlist:`,
    ...r.scores.slice(0, 5).map((s) => `  ${String(s.rank).padStart(2)}. ${s.name.padEnd(22)} ${display10(s.score)}`),
    `paid to be considered: ${r.paid_to_be_considered.length ? r.paid_to_be_considered.map((p) => `${p.brand} $${p.amount}`).join(", ") : "none"}`,
    `affected ranking: ${r.affected_ranking ? "YES" : "NO"}`,
    `counterfactual: ${r.counterfactuals[0]?.summary ?? "n/a"}`,
  ];
  if (status) lines.push(`signature: ● ${status}`);
  return lines.join("\n");
}

export function formatShortlist(res: ShortlistResult): string {
  const notes = res.notes.length ? `\nnotes: ${res.notes.join("; ")}` : "";
  return `${formatReceiptCard(res.receipt)}${notes}\n\nThe full signed receipt is in the next block. Check it with verify_receipt or POST /verify.`;
}

export function formatVerify(v: VerifyResult): string {
  return [`${v.status}  ${v.receipt_id ?? ""}`, ...v.checks.map((c) => `  ${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? ` (${c.detail})` : ""}`)].join("\n");
}

export function formatExplain(e: ExplainResult): string {
  return [
    `What-if for ${e.receipt_id}: ${e.winner_changed ? "the winner CHANGES" : "the winner stays the same"}`,
    `weights: ${e.new_criteria.map((c) => `${c.key} ${c.weight}`).join(", ")}`,
    ...e.rows.slice(0, 8).map((r) => {
      const move = r.old_rank === r.new_rank ? "  =" : r.new_rank < r.old_rank ? ` ↑${r.old_rank - r.new_rank}` : ` ↓${r.new_rank - r.old_rank}`;
      return `  ${String(r.new_rank).padStart(2)}. ${r.name.padEnd(22)} ${display10(r.new_score)}  (was #${r.old_rank}, ${display10(r.old_score)})${move}`;
    }),
    e.counterfactuals[0] ? `counterfactual: ${e.counterfactuals[0].summary}` : "",
    e.note,
  ]
    .filter(Boolean)
    .join("\n");
}
