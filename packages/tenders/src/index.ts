import { MockPaymentVerifier } from "./mock-verifier.ts";
import type { PaymentVerifier } from "./payment.ts";
import { X402PaymentVerifier } from "./x402-verifier.ts";

export * from "./payment.ts";
export * from "./tenders.ts";
export { MockPaymentVerifier } from "./mock-verifier.ts";
export { X402PaymentVerifier, type X402Config } from "./x402-verifier.ts";

/** Picks the payment verifier from env. Mock unless SHORTLISTED_PAYMENTS=x402. */
export function paymentVerifierFromEnv(env: Record<string, string | undefined> = process.env): PaymentVerifier {
  if (env.SHORTLISTED_PAYMENTS === "x402") {
    return new X402PaymentVerifier({
      facilitatorUrl: env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
      network: env.X402_NETWORK ?? "base-sepolia",
      payTo: env.X402_PAY_TO ?? "",
    });
  }
  return new MockPaymentVerifier();
}
