import earbuds from "../data/earbuds.json" with { type: "json" };
import laptops from "../data/laptops.json" with { type: "json" };
import { CATEGORIES } from "./categories.ts";
import { CatalogOfferSchema, applyFilters, type CatalogOffer, type CatalogProvider, type CatalogQuery } from "./provider.ts";

/** Fictional seed catalog (40 products). Every attribute carries a source record. */
export class SeedCatalog implements CatalogProvider {
  readonly name = "seed";
  private readonly offers: CatalogOffer[];

  constructor(offers: unknown[] = [...earbuds, ...laptops]) {
    this.offers = offers.map((o) => CatalogOfferSchema.parse(o));
  }

  categories() {
    return CATEGORIES;
  }

  async search(query: CatalogQuery): Promise<CatalogOffer[]> {
    return applyFilters(this.offers, query);
  }

  async get(id: string): Promise<CatalogOffer | null> {
    return this.offers.find((o) => o.id === id) ?? null;
  }

  all(): CatalogOffer[] {
    return [...this.offers];
  }
}
