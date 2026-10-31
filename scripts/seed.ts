// Bootstraps the local database and signing key, and records mock tolls so receipts show who paid.
// Idempotent: tolls are reset on each run.
import { SeedCatalog } from "@shortlisted/catalog";
import { Repo, defaultDbUrl, loadDotEnv, loadSigningKey, openDb } from "@shortlisted/store";

loadDotEnv();

const TOLLS: { brand: string; category: string }[] = [
  { brand: "AcmeBuds", category: "earbuds" },
  { brand: "Kestrel", category: "earbuds" },
  { brand: "Halcyon", category: "laptops" },
  { brand: "Vireo", category: "laptops" },
];

const url = defaultDbUrl();
const { db } = await openDb(url);
const repo = new Repo(db);
const key = await loadSigningKey();
const catalog = new SeedCatalog();

await repo.clearTolls();
for (const t of TOLLS) {
  await repo.recordToll(
    t.category,
    { brand: t.brand, amount: "0.02", currency: "USDC", rail: "mock", reference: `mock_seed_${t.brand.toLowerCase()}_${t.category}` },
    new Date().toISOString(),
  );
}

console.log(`seeded ${url}`);
console.log(`  catalog: ${catalog.all().length} products (${catalog.categories().map((c) => c.id).join(", ")})`);
console.log(`  tolls:   ${TOLLS.map((t) => `${t.brand}/${t.category}`).join(", ")} at $0.02 (mock)`);
console.log(`  issuer:  ${key.publicKey}${process.env.SHORTLISTED_ED25519_PRIVATE_KEY ? "" : " (dev key in .data/)"}`);
