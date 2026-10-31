import { CATEGORIES } from "../categories.ts";
import type { CatalogOffer, CatalogProvider, CatalogQuery } from "../provider.ts";

/**
 * Shopify Storefront API adapter (stub).
 *
 * Plan: query `products(query:)` via the Storefront GraphQL API with a public access token,
 * map variant price to `price` with source { type: "retailer", ref: <product URL> }, and read
 * spec attributes from product metafields (namespace "specs"), sourcing them as "manufacturer".
 * Products missing a required attribute are skipped rather than guessed.
 */
export class ShopifyStorefrontCatalog implements CatalogProvider {
  readonly name = "shopify";
  constructor(private readonly opts: { shopDomain: string; storefrontToken: string }) {}

  categories() {
    return CATEGORIES;
  }

  async search(_query: CatalogQuery): Promise<CatalogOffer[]> {
    throw new Error(`ShopifyStorefrontCatalog is not implemented yet (shop: ${this.opts.shopDomain})`);
  }

  async get(_id: string): Promise<CatalogOffer | null> {
    throw new Error("ShopifyStorefrontCatalog is not implemented yet");
  }
}
