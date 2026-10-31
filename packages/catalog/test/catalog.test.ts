import { describe, expect, it } from "vitest";
import { CATEGORIES, SeedCatalog, toScorableOffer } from "../src/index.ts";

describe("SeedCatalog", () => {
  const catalog = new SeedCatalog();

  it("has about 40 products across earbuds and laptops", () => {
    const all = catalog.all();
    expect(all.length).toBe(40);
    expect(new Set(all.map((o) => o.category))).toEqual(new Set(["earbuds", "laptops"]));
    expect(new Set(all.map((o) => o.id)).size).toBe(all.length);
  });

  it("records a source for every attribute and covers every schema attribute", () => {
    for (const o of catalog.all()) {
      const schema = CATEGORIES.find((c) => c.id === o.category)!;
      for (const a of schema.attributes) {
        const attr = o.attributes[a.key];
        expect(attr, `${o.id}.${a.key}`).toBeDefined();
        expect(attr!.source.ref).toMatch(/^https:\/\//);
      }
    }
  });

  it("applies hard filters deterministically", async () => {
    const res = await catalog.search({ category: "earbuds", max: { price: 100 }, min: { anc: 1 } });
    expect(res.length).toBeGreaterThan(3);
    expect(res.every((o) => o.attributes.price!.value <= 100 && o.attributes.anc!.value === 1)).toBe(true);
    expect(res.map((o) => o.id)).toEqual([...res.map((o) => o.id)].sort());
  });

  it("flattens to a fee-free scorable offer", async () => {
    const o = (await catalog.get("eb-kestrel-one"))!;
    expect(toScorableOffer(o)).toEqual({
      id: "eb-kestrel-one",
      name: "Kestrel One",
      brand: "Kestrel",
      attributes: expect.objectContaining({ price: 89, battery_hours: 36 }),
    });
  });
});
