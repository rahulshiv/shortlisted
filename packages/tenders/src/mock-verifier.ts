import { sha256Hex } from "@shortlisted/core";
import type { PaymentRequirements, PaymentVerdict, PaymentVerifier, TollPrice } from "./payment.ts";

/**
 * Local stand-in for x402. Follows the same 402 handshake, but accepts any X-PAYMENT
 * header of the form "mock:<payer>" (or base64 JSON with network "mock"). No money moves.
 */
export class MockPaymentVerifier implements PaymentVerifier {
  readonly rail = "mock" as const;

  requirements(resource: string, price: TollPrice, description: string): PaymentRequirements {
    return {
      scheme: "exact",
      network: "mock",
      maxAmountRequired: price.amount,
      resource,
      description,
      mimeType: "application/json",
      payTo: "mock:shortlisted",
      maxTimeoutSeconds: 60,
      asset: price.currency,
    };
  }

  async verify(header: string | undefined, req: PaymentRequirements, brand: string, price: TollPrice): Promise<PaymentVerdict> {
    if (!header) return { ok: false, reason: "X-PAYMENT header is required" };
    let payer: string | undefined;
    if (header.startsWith("mock:")) payer = header.slice(5);
    else {
      try {
        const decoded = JSON.parse(atob(header)) as { network?: string; payload?: { payer?: string } };
        if (decoded.network === "mock") payer = decoded.payload?.payer ?? "anonymous";
      } catch {
        // fall through
      }
    }
    if (!payer) return { ok: false, reason: "mock verifier expects X-PAYMENT: mock:<payer>" };
    const reference = `mock_${sha256Hex(`${req.resource}|${brand}|${payer}`).slice(0, 16)}`;
    return { ok: true, payment: { brand, amount: price.amount, currency: price.currency, rail: "mock", reference } };
  }
}
