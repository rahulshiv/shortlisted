import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSeedHex, signingKeyFromSeed, type SigningKey } from "@shortlisted/receipts";

/** Repo root, resolved from this file so it works whatever cwd an MCP client launches us with. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const DATA_DIR = resolve(REPO_ROOT, ".data");

/**
 * Loads the repo-root .env into process.env, if present. Variables already set in the
 * environment win. Idempotent.
 */
export function loadDotEnv(): void {
  const file = resolve(REPO_ROOT, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}

export function defaultDbUrl(): string {
  if (process.env.SHORTLISTED_DB_URL) return process.env.SHORTLISTED_DB_URL;
  mkdirSync(DATA_DIR, { recursive: true });
  return `file:${resolve(DATA_DIR, "shortlisted.db")}`;
}

/**
 * Signing key from SHORTLISTED_ED25519_PRIVATE_KEY, or a dev key persisted in .data/
 * (created on first use) so the MCP server and the API sign with the same identity.
 */
export async function loadSigningKey(): Promise<SigningKey> {
  const fromEnv = process.env.SHORTLISTED_ED25519_PRIVATE_KEY?.trim();
  if (fromEnv) return signingKeyFromSeed(fromEnv);
  const file = resolve(DATA_DIR, "dev-signing-key.hex");
  if (!existsSync(file)) {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(file, generateSeedHex() + "\n", { mode: 0o600 });
  }
  return signingKeyFromSeed(readFileSync(file, "utf8").trim());
}
