import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema.ts";

export type Db = LibSQLDatabase<typeof schema>;

export interface OpenedDb {
  db: Db;
  client: Client;
}

/**
 * Opens (and bootstraps) the database. `url` is a libsql URL: "file:path.db", ":memory:", or a
 * Turso URL ("libsql://…"), which also needs `authToken` (default SHORTLISTED_DB_AUTH_TOKEN).
 */
export async function openDb(url: string, authToken = process.env.SHORTLISTED_DB_AUTH_TOKEN || undefined): Promise<OpenedDb> {
  const client = createClient(authToken ? { url, authToken } : { url });
  for (const stmt of schema.BOOTSTRAP_SQL) await client.execute(stmt);
  return { db: drizzle(client, { schema }), client };
}
