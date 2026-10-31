import type { CategorySchema } from "./provider.ts";

/**
 * Category schemas. Each attribute's direction is fixed here, never chosen by a model:
 * the LLM only picks which attributes matter and how much.
 */
export const CATEGORIES: CategorySchema[] = [
  {
    id: "earbuds",
    label: "Wireless earbuds",
    keywords: ["earbud", "earbuds", "earphone", "earphones", "headphone", "headphones", "buds", "in-ear", "tws"],
    attributes: [
      { key: "price", direction: "lower", unit: "USD", description: "Current retail price" },
      { key: "battery_hours", direction: "higher", unit: "hours", description: "Total playback including charging case" },
      { key: "sound_quality", direction: "higher", unit: "0-10", description: "Aggregated review score for sound" },
      { key: "comfort", direction: "higher", unit: "0-10", description: "Aggregated review score for fit and comfort" },
      { key: "anc", direction: "higher", unit: "0/1", description: "Has active noise cancellation" },
      { key: "water_resistance_ipx", direction: "higher", unit: "IPX", description: "Water resistance rating" },
      { key: "weight_g", direction: "lower", unit: "g", description: "Weight per earbud" },
      { key: "latency_ms", direction: "lower", unit: "ms", description: "Bluetooth audio latency" },
    ],
  },
  {
    id: "laptops",
    label: "Laptops",
    keywords: ["laptop", "laptops", "notebook", "ultrabook", "chromebook", "macbook"],
    attributes: [
      { key: "price", direction: "lower", unit: "USD", description: "Current retail price" },
      { key: "battery_hours", direction: "higher", unit: "hours", description: "Video playback battery life" },
      { key: "cpu_score", direction: "higher", unit: "points", description: "Multi-core CPU benchmark" },
      { key: "ram_gb", direction: "higher", unit: "GB", description: "Memory" },
      { key: "storage_gb", direction: "higher", unit: "GB", description: "SSD storage" },
      { key: "weight_kg", direction: "lower", unit: "kg", description: "Weight" },
      { key: "display_nits", direction: "higher", unit: "nits", description: "Peak display brightness" },
      { key: "build_quality", direction: "higher", unit: "0-10", description: "Aggregated review score for build" },
    ],
  },
];

export function getCategory(id: string): CategorySchema | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

export function directionFor(category: string, key: string) {
  return getCategory(category)?.attributes.find((a) => a.key === key)?.direction;
}
