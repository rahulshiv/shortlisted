// Prints a fresh Ed25519 seed for SHORTLISTED_ED25519_PRIVATE_KEY. Keep it secret and stable.
import { generateSeedHex, signingKeyFromSeed } from "@shortlisted/receipts";

const key = await signingKeyFromSeed(generateSeedHex());
console.log(`SHORTLISTED_ED25519_PRIVATE_KEY=${key.seed}`);
console.error(`public key: ${key.publicKey}`);
