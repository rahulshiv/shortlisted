import type { PaymentRequirements, PaymentVerdict, PaymentVerifier, TollPrice } from "./payment.ts";
import { toAtomic } from "./payment.ts";

/** USDC contract addresses for the networks we accept. */
const USDC: Record<string, string> = {
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

export interface X402Config {
  /** Facilitator base URL, e.g. https://x402.org/facilitator (testnet). */
  facilitatorUrl: string;
  network: string;
  /** Address that receives the toll. */
  payTo: string;
}

/**
 * Real x402 verification through a facilitator's /verify and /settle endpoints (x402 v1, "exact" scheme).
 * Enabled with SHORTLISTED_PAYMENTS=x402. Not exercised by the test suite; validate against a
 * testnet facilitator before relying on it.
 */
export class X402PaymentVerifier implements PaymentVerifier {
  readonly rail = "x402" as const;
  constructor(private readonly cfg: X402Config) {
    if (!USDC[cfg.network]) throw new Error(`x402: unsupported network "${cfg.network}"`);
    if (!/^0x[0-9a-fA-F]{40}$/.test(cfg.payTo)) throw new Error("x402: X402_PAY_TO must be an EVM address");
  }

  requirements(resource: string, price: TollPrice, description: string): PaymentRequirements {
    if (price.currency !== "USDC") throw new Error("x402: only USDC tolls are supported");
    return {
      scheme: "exact",
      network: this.cfg.network,
      maxAmountRequired: toAtomic(price.amount, 6),
      resource,
      description,
      mimeType: "application/json",
      payTo: this.cfg.payTo,
      maxTimeoutSeconds: 60,
      asset: USDC[this.cfg.network]!,
      extra: { name: "USDC", version: "2" },
    };
  }

  async verify(header: string | undefined, req: PaymentRequirements, brand: string, price: TollPrice): Promise<PaymentVerdict> {
    if (!header) return { ok: false, reason: "X-PAYMENT header is required" };
    let paymentPayload: unknown;
    try {
      paymentPayload = JSON.parse(atob(header));
    } catch {
      return { ok: false, reason: "X-PAYMENT is not base64-encoded JSON" };
    }
    const body = JSON.stringify({ x402Version: 1, paymentPayload, paymentRequirements: req });
    const headers = { "content-type": "application/json" };

    const v = (await (await fetch(`${this.cfg.facilitatorUrl}/verify`, { method: "POST", headers, body })).json()) as {
      isValid?: boolean;
      invalidReason?: string;
    };
    if (!v.isValid) return { ok: false, reason: `payment invalid: ${v.invalidReason ?? "unknown"}` };

    const s = (await (await fetch(`${this.cfg.facilitatorUrl}/settle`, { method: "POST", headers, body })).json()) as {
      success?: boolean;
      transaction?: string;
      errorReason?: string;
    };
    if (!s.success || !s.transaction) return { ok: false, reason: `settlement failed: ${s.errorReason ?? "unknown"}` };
    return { ok: true, payment: { brand, amount: price.amount, currency: price.currency, rail: "x402", reference: s.transaction } };
  }
}
