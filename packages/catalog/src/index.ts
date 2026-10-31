import type { ScorableOffer } from "@shortlisted/core";
import type { CatalogOffer } from "./provider.ts";

export * from "./provider.ts";
export * from "./categories.ts";
export { SeedCatalog } from "./seed-adapter.ts";
export { ShopifyStorefrontCatalog } from "./adapters/shopify.ts";
export { GoogleShoppingCatalog } from "./adapters/google-shopping.ts";

/** Flattens a catalog offer to the fee-free shape the scorer accepts. Sources stay in the catalog. */
export function toScorableOffer(offer: CatalogOffer): ScorableOffer {
  const attributes: Record<string, number> = {};
  for (const [k, v] of Object.entries(offer.attributes)) attributes[k] = v.value;
  return { id: offer.id, name: offer.name, brand: offer.brand, attributes };
}
