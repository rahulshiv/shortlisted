import { and, asc, eq } from "drizzle-orm";
import type { PaymentRecord, Receipt } from "@shortlisted/receipts";
import type { Db } from "./db.ts";
import { receipts, tenderOffers, tenders, tolls } from "./schema.ts";

export type TenderRow = typeof tenders.$inferSelect;
export type TenderOfferRow = typeof tenderOffers.$inferSelect;

export class Repo {
  constructor(readonly db: Db) {}

  async saveReceipt(receipt: Receipt): Promise<void> {
    await this.db.insert(receipts).values({ id: receipt.id, body: receipt, createdAt: receipt.issued_at }).onConflictDoNothing();
  }

  async getReceipt(id: string): Promise<Receipt | null> {
    const row = await this.db.query.receipts.findFirst({ where: eq(receipts.id, id) });
    return (row?.body as Receipt | undefined) ?? null;
  }

  async insertTender(row: typeof tenders.$inferInsert): Promise<void> {
    await this.db.insert(tenders).values(row);
  }

  async getTender(id: string): Promise<TenderRow | null> {
    return (await this.db.query.tenders.findFirst({ where: eq(tenders.id, id) })) ?? null;
  }

  async closeTender(id: string, receiptId: string | null, closedAt: string): Promise<void> {
    await this.db.update(tenders).set({ status: "closed", receiptId, closedAt }).where(and(eq(tenders.id, id), eq(tenders.status, "open")));
  }

  async insertTenderOffer(row: typeof tenderOffers.$inferInsert): Promise<void> {
    await this.db.insert(tenderOffers).values(row);
  }

  async findTenderOffer(tenderId: string, brand: string): Promise<TenderOfferRow | null> {
    return (await this.db.query.tenderOffers.findFirst({ where: and(eq(tenderOffers.tenderId, tenderId), eq(tenderOffers.brand, brand)) })) ?? null;
  }

  async listTenderOffers(tenderId: string): Promise<TenderOfferRow[]> {
    return this.db.select().from(tenderOffers).where(eq(tenderOffers.tenderId, tenderId)).orderBy(asc(tenderOffers.id));
  }

  async recordToll(category: string, payment: PaymentRecord, createdAt: string): Promise<void> {
    await this.db.insert(tolls).values({ category, createdAt, ...payment });
  }

  async listTolls(category: string): Promise<PaymentRecord[]> {
    const rows = await this.db.select().from(tolls).where(eq(tolls.category, category)).orderBy(asc(tolls.id));
    return rows.map((r) => ({ brand: r.brand, amount: r.amount, currency: r.currency, rail: r.rail, reference: r.reference }));
  }

  async clearTolls(): Promise<void> {
    await this.db.delete(tolls);
  }
}
