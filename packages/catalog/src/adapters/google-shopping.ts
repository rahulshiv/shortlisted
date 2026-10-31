import { CATEGORIES } from "../categories.ts";
import type { CatalogOffer, CatalogProvider, CatalogQuery } from "../provider.ts";

/**
 * Google Shopping adapter (stub).
 *
 * Plan: use the Merchant/Content API for products the merchant owns, mapping `price.value` to
 * `price` (source "retailer") and product detail attributes to category attributes. Note this
 * may involve a paid or quota-limited Google API; confirm before enabling.
 */
export class GoogleShoppingCatalog implements CatalogProvider {
  readonly name = "google-shopping";
  constructor(private readonly opts: { merchantId: string }) {}

  categories() {
    return CATEGORIES;
  }

  async search(_query: CatalogQuery): Promise<CatalogOffer[]> {
    throw new Error(`GoogleShoppingCatalog is not implemented yet (merchant: ${this.opts.merchantId})`);
  }

  async get(_id: string): Promise<CatalogOffer | null> {
    throw new Error("GoogleShoppingCatalog is not implemented yet");
  }
}
