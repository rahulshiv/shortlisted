import { z } from "zod";
import type { Direction } from "@shortlisted/core";

export const AttributeSourceSchema = z
  .object({
    type: z.enum(["manufacturer", "retailer", "review_aggregate", "lab_measurement", "brand_submission", "seed"]),
    ref: z.string(),
    retrieved_at: z.string(),
  })
  .strict();

export const CatalogOfferSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    brand: z.string(),
    category: z.string(),
    url: z.string().url(),
    attributes: z.record(z.object({ value: z.number(), unit: z.string(), source: AttributeSourceSchema }).strict()),
  })
  .strict();

export type AttributeSource = z.infer<typeof AttributeSourceSchema>;
export type CatalogOffer = z.infer<typeof CatalogOfferSchema>;

export interface AttributeSpec {
  key: string;
  direction: Direction;
  unit: string;
  description: string;
}

export interface CategorySchema {
  id: string;
  label: string;
  /** Words that suggest this category in a free-text query. */
  keywords: string[];
  attributes: AttributeSpec[];
}

/** Hard filters. Applied before scoring; an offer either passes or is not a candidate. */
export interface CatalogQuery {
  category: string;
  /** Inclusive upper bound per attribute, e.g. { price: 100 }. */
  max?: Record<string, number>;
  /** Inclusive lower bound per attribute, e.g. { anc: 1 }. */
  min?: Record<string, number>;
  brands?: string[];
}

export interface CatalogProvider {
  readonly name: string;
  categories(): CategorySchema[];
  search(query: CatalogQuery): Promise<CatalogOffer[]>;
  get(id: string): Promise<CatalogOffer | null>;
}

/** Applies a CatalogQuery's hard filters. Deterministic, and sorts by id. */
export function applyFilters(offers: readonly CatalogOffer[], q: CatalogQuery): CatalogOffer[] {
  const brands = q.brands?.map((b) => b.toLowerCase());
  return offers
    .filter((o) => o.category === q.category)
    .filter((o) => !brands?.length || brands.includes(o.brand.toLowerCase()))
    .filter((o) =>
      Object.entries(q.max ?? {}).every(([k, bound]) => {
        const v = o.attributes[k]?.value;
        return v !== undefined && v <= bound;
      }),
    )
    .filter((o) =>
      Object.entries(q.min ?? {}).every(([k, bound]) => {
        const v = o.attributes[k]?.value;
        return v !== undefined && v >= bound;
      }),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
