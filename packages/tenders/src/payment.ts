import type { PaymentRecord } from "@shortlisted/receipts";

/** x402 "exact" scheme payment requirements, as returned in a 402 response's `accepts` list. */
export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  /** Amount in the asset's atomic units (USDC has 6 decimals: $0.02 = "20000"). */
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra?: Record<string, unknown>;
}

export interface TollPrice {
  /** Decimal string in `currency`, e.g. "0.02". */
  amount: string;
  currency: string;
}

export type PaymentVerdict = { ok: true; payment: PaymentRecord } | { ok: false; reason: string };

/**
 * Gate for the flat toll a brand pays to be considered. The verdict only decides whether
 * an offer is admitted. It never produces data that reaches the scorer.
 */
export interface PaymentVerifier {
  readonly rail: "mock" | "x402";
  requirements(resource: string, price: TollPrice, description: string): PaymentRequirements;
  /** `header` is the raw X-PAYMENT header, or undefined if the client sent none. */
  verify(header: string | undefined, requirements: PaymentRequirements, brand: string, price: TollPrice): Promise<PaymentVerdict>;
}

/** The body of an HTTP 402 response per the x402 spec. */
export function paymentRequiredBody(requirements: PaymentRequirements, error = "X-PAYMENT header is required") {
  return { x402Version: 1, error, accepts: [requirements] };
}

/** Converts a decimal amount to atomic units without floating point. */
export function toAtomic(amount: string, decimals: number): string {
  const [whole = "0", frac = ""] = amount.split(".");
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0")).toString();
}
