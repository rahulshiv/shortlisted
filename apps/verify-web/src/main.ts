import { verifyReceipt, type Receipt, type VerifyResult } from "@shortlisted/receipts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const receiptEl = $<HTMLTextAreaElement>("receipt");
const issuerEl = $<HTMLInputElement>("issuer");
const pubkeyEl = $<HTMLInputElement>("pubkey");
const ridEl = $<HTMLInputElement>("rid");
const errorEl = $<HTMLParagraphElement>("error");
const cardEl = $<HTMLDivElement>("card");
const detailsEl = $<HTMLDivElement>("details");

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const score10 = (s: number) => (s * 10).toFixed(2);

function showError(msg: string | null) {
  errorEl.hidden = !msg;
  errorEl.textContent = msg ?? "";
}

async function issuerKey(): Promise<string> {
  const pasted = pubkeyEl.value.trim();
  if (pasted) return pasted;
  const res = await fetch(`${issuerEl.value.replace(/\/$/, "")}/.well-known/shortlisted-pubkey`);
  if (!res.ok) throw new Error(`could not fetch issuer key (${res.status})`);
  return ((await res.json()) as { public_key: string }).public_key;
}

const line = (label: string, value: string, marked = false) =>
  `<div class="line"><span>${label}</span><span class="val"><span>${value}</span><span class="marker${marked ? " on" : ""}">&lt;</span></span></div>`;
const heading = (left: string, right?: string) =>
  right ? `<div class="line"><span class="smallcaps">${left}</span><span class="smallcaps">${right}</span></div>` : `<div class="smallcaps">${left}</div>`;
const rule = `<div class="dotted-rule"></div>`;

/** Same structure, labels and order as the receipt card on shortlisted.tech. */
function renderCard(r: Receipt, v: VerifyResult) {
  const queryLines = r.query.text.split(/\s+with\s+/i);
  const paidBrands = r.paid_to_be_considered;
  cardEl.innerHTML = `
    <div class="card">
      <div class="card-head"><span class="title">DECISION RECEIPT</span><span>${esc(r.id)}</span></div>
      <div class="card-body">
        ${heading("QUERY")}
        <div style="margin-top:4px">${esc(queryLines[0])}</div>
        ${queryLines.slice(1).map((l) => `<div>${esc(l)}</div>`).join("")}
        ${rule}
        ${heading("CRITERIA", "WEIGHT")}
        <div style="margin-top:4px">${r.criteria.items.map((c) => line(esc(c.key), c.weight.toFixed(2))).join("")}</div>
        ${rule}
        ${heading("SHORTLIST", "SCORE")}
        <div style="margin-top:4px">${r.scores.slice(0, 5).map((s, i) => line(esc(s.name), score10(s.score), i === 0)).join("")}</div>
        ${rule}
        ${heading("PAID TO BE CONSIDERED")}
        <div style="margin-top:4px">
          ${paidBrands.length ? paidBrands.map((p) => line(esc(p.brand), `$${esc(p.amount)}`)).join("") : line("nobody", "—")}
          ${line("affected ranking:", r.affected_ranking ? "YES" : "NO")}
        </div>
        ${rule}
        ${heading("COUNTERFACTUAL")}
        <div style="margin-top:4px">${esc(r.counterfactuals[0]?.summary ?? "n/a")}</div>
        ${rule}
        <div class="line"><span class="muted">signature</span><span class="status ${v.valid ? "valid" : "invalid"}">● ${v.status}</span></div>
      </div>
    </div>`;
}

function renderDetails(r: Receipt, v: VerifyResult) {
  const keys = r.criteria.items.map((c) => c.key);
  const offers = new Map(r.inputs.offers.map((o) => [o.id, o]));
  const paid = new Set(r.paid_to_be_considered.map((p) => p.brand));
  detailsEl.innerHTML = `
    <div class="details">
      <div class="section">
        ${heading("Checks")}
        <ul class="checks">${v.checks
          .map((c) => `<li><span class="${c.ok ? "ok" : "bad"}">${c.ok ? "✓" : "✗"}</span><span>${esc(c.name)}${c.detail ? ` <span class="detail">${esc(c.detail)}</span>` : ""}</span></li>`)
          .join("")}</ul>
      </div>
      <div class="section">
        ${heading("Score table", `${r.scores.length} candidates`)}
        <div class="table-wrap"><table>
          <thead><tr><th>#</th><th>offer</th><th>score</th>${keys.map((k) => `<th>${esc(k)}</th>`).join("")}</tr></thead>
          <tbody>${r.scores
            .map((s) => {
              const o = offers.get(s.offer_id);
              return `<tr class="${paid.has(s.brand) ? "paid" : ""}"><td>${s.rank}</td><td>${esc(s.name)}</td><td>${score10(s.score)}</td>${keys
                .map((k) => `<td>${o?.attributes[k] ?? "—"}</td>`)
                .join("")}</tr>`;
            })
            .join("")}</tbody>
        </table></div>
        <p class="muted" style="font-size:12px">$ marks a brand that paid the flat toll to be considered. Scores are re-computed here from the inputs above.</p>
      </div>
      <div class="section">
        ${heading("Who paid")}
        <div class="table-wrap"><table>
          <thead><tr><th>brand</th><th>rail</th><th>amount</th><th>reference</th></tr></thead>
          <tbody>${
            r.paid_to_be_considered.length
              ? r.paid_to_be_considered.map((p) => `<tr><td>${esc(p.brand)}</td><td>${esc(p.rail)}</td><td>${esc(p.amount)} ${esc(p.currency)}</td><td>${esc(p.reference)}</td></tr>`).join("")
              : `<tr><td colspan="4">nobody paid</td></tr>`
          }</tbody>
        </table></div>
      </div>
      <div class="section muted" style="font-size:12px">
        issued ${esc(r.issued_at)} · criteria from ${esc(r.criteria.source)} · ${esc(r.scorer.name)}@${esc(r.scorer.version)} · inputs ${esc(r.inputs.offers_hash.slice(0, 23))}…
      </div>
    </div>`;
}

function renderEmpty() {
  cardEl.innerHTML = `<div class="empty"><div class="smallcaps">No receipt yet</div><p class="muted">Paste one on the left, or load one by id.</p></div>`;
  detailsEl.innerHTML = "";
}

async function run() {
  showError(null);
  let parsed: unknown;
  try {
    parsed = JSON.parse(receiptEl.value);
  } catch {
    showError("That isn't valid JSON.");
    return;
  }
  // Accept a bare receipt, or a tool result shaped like { receipt: … }.
  const candidate = (parsed as { receipt?: unknown }).receipt ?? parsed;
  let key: string | undefined;
  try {
    key = await issuerKey();
  } catch (err) {
    showError(`${(err as Error).message}. Verifying against the key embedded in the receipt, which proves integrity but not who issued it.`);
  }
  const v = await verifyReceipt(candidate, key);
  if (!v.checks.find((c) => c.name === "schema")?.ok) {
    renderEmpty();
    showError(`INVALID: ${v.checks[0]?.detail ?? "not a Shortlisted receipt"}`);
    return;
  }
  renderCard(candidate as Receipt, v);
  renderDetails(candidate as Receipt, v);
}

async function loadById(id: string) {
  showError(null);
  const res = await fetch(`${issuerEl.value.replace(/\/$/, "")}/receipts/${encodeURIComponent(id)}`);
  if (!res.ok) return showError(`receipt ${id} not found (${res.status})`);
  receiptEl.value = JSON.stringify(await res.json(), null, 2);
  await run();
}

$("verify").addEventListener("click", run);
$("load").addEventListener("click", () => ridEl.value.trim() && loadById(ridEl.value.trim()));
receiptEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run();
});

const params = new URLSearchParams(location.search);
// Deployed, the API is served from the same origin as this page. In `pnpm dev` it's on :8787.
if (location.port !== "5173") issuerEl.value = location.origin;
if (params.get("issuer")) issuerEl.value = params.get("issuer")!;
if (params.get("id")) {
  ridEl.value = params.get("id")!;
  loadById(ridEl.value);
} else renderEmpty();
