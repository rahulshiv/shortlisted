import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const receipts = sqliteTable("receipts", {
  id: text("id").primaryKey(),
  body: text("body", { mode: "json" }).notNull(),
  createdAt: text("created_at").notNull(),
});

export const tenders = sqliteTable("tenders", {
  id: text("id").primaryKey(),
  spec: text("spec", { mode: "json" }).notNull(),
  criteria: text("criteria", { mode: "json" }).notNull(),
  status: text("status", { enum: ["open", "closed"] }).notNull(),
  deadline: text("deadline").notNull(),
  tollAmount: text("toll_amount").notNull(),
  tollCurrency: text("toll_currency").notNull(),
  receiptId: text("receipt_id"),
  createdAt: text("created_at").notNull(),
  closedAt: text("closed_at"),
});

export const tenderOffers = sqliteTable(
  "tender_offers",
  {
    id: text("id").primaryKey(),
    tenderId: text("tender_id").notNull(),
    brand: text("brand").notNull(),
    /** Fee-free ScorableOffer plus attribute sources. */
    offer: text("offer", { mode: "json" }).notNull(),
    /** Payment record, stored apart from the offer. */
    payment: text("payment", { mode: "json" }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("tender_offers_tender_brand").on(t.tenderId, t.brand)],
);

/** Brands that paid the flat toll to be considered in a category's catalog shortlists. */
export const tolls = sqliteTable(
  "tolls",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    brand: text("brand").notNull(),
    category: text("category").notNull(),
    amount: text("amount").notNull(),
    currency: text("currency").notNull(),
    rail: text("rail", { enum: ["x402", "mock"] }).notNull(),
    reference: text("reference").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("tolls_category").on(t.category)],
);

/** Bootstrap DDL matching the Drizzle schema above. Swap for drizzle-kit migrations when moving to Postgres. */
export const BOOTSTRAP_SQL = [
  `CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS tenders (id TEXT PRIMARY KEY, spec TEXT NOT NULL, criteria TEXT NOT NULL, status TEXT NOT NULL, deadline TEXT NOT NULL, toll_amount TEXT NOT NULL, toll_currency TEXT NOT NULL, receipt_id TEXT, created_at TEXT NOT NULL, closed_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS tender_offers (id TEXT PRIMARY KEY, tender_id TEXT NOT NULL, brand TEXT NOT NULL, offer TEXT NOT NULL, payment TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS tender_offers_tender_brand ON tender_offers (tender_id, brand)`,
  `CREATE TABLE IF NOT EXISTS tolls (id INTEGER PRIMARY KEY AUTOINCREMENT, brand TEXT NOT NULL, category TEXT NOT NULL, amount TEXT NOT NULL, currency TEXT NOT NULL, rail TEXT NOT NULL, reference TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS tolls_category ON tolls (category)`,
];
