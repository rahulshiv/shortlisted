import { SeedCatalog, type CatalogProvider } from "@shortlisted/catalog";
import type { SigningKey } from "@shortlisted/receipts";
import { Repo, defaultDbUrl, loadDotEnv, loadSigningKey, openDb } from "@shortlisted/store";
import { Tenders, paymentVerifierFromEnv } from "@shortlisted/tenders";
import type { CriteriaResolver } from "./criteria.ts";
import { HeuristicResolver } from "./heuristic.ts";
import { FallbackResolver, LlmResolver } from "./llm.ts";

export interface Context {
  repo: Repo;
  key: SigningKey;
  catalog: CatalogProvider;
  resolver: CriteriaResolver;
  tenders: Tenders;
  apiBaseUrl: string;
  clock: () => Date;
}

/** Resolver from env: Claude when ANTHROPIC_API_KEY is set (heuristic as fallback), otherwise heuristic only. */
export function resolverFromEnv(env = process.env): CriteriaResolver {
  if (env.SHORTLISTED_CRITERIA === "heuristic" || !env.ANTHROPIC_API_KEY) return new HeuristicResolver();
  return new FallbackResolver(new LlmResolver(), new HeuristicResolver());
}

export async function createContext(overrides: Partial<Context> & { dbUrl?: string } = {}): Promise<Context> {
  loadDotEnv();
  const { db } = await openDb(overrides.dbUrl ?? defaultDbUrl());
  const repo = overrides.repo ?? new Repo(db);
  const key = overrides.key ?? (await loadSigningKey());
  const apiBaseUrl = overrides.apiBaseUrl ?? process.env.SHORTLISTED_API_URL ?? "http://localhost:8787";
  return {
    repo,
    key,
    catalog: overrides.catalog ?? new SeedCatalog(),
    resolver: overrides.resolver ?? resolverFromEnv(),
    tenders: overrides.tenders ?? new Tenders({ repo, key, verifier: paymentVerifierFromEnv(), apiBaseUrl }),
    apiBaseUrl,
    clock: overrides.clock ?? (() => new Date()),
  };
}
