import { describe, expect, it } from "vitest";
import { counterfactuals, priceToWin, scoreOffers, type ScorableOffer } from "../src/index.ts";
import { earbudCriteria, earbudOffers } from "./fixtures.ts";

function reprice(offers: ScorableOffer[], id: string, price: number): ScorableOffer[] {
  return offers.map((o) => (o.id === id ? { ...o, attributes: { ...o.attributes, price } } : o));
}

describe("counterfactuals", () => {
  it("returns the runner-up's price-to-win", () => {
    const ranked = scoreOffers(earbudCriteria, earbudOffers);
    const [cf] = counterfactuals(earbudCriteria, earbudOffers);
    expect(cf).toBeDefined();
    expect(cf!.offer_id).toBe(ranked[1]!.offer_id);
    expect(cf!.versus_offer_id).toBe(ranked[0]!.offer_id);
    expect(cf!.wins_below).not.toBeNull();
    expect(cf!.summary).toMatch(/wins below \$\d+\.\d{2}$/);
  });

  it("the computed price actually flips the ranking", () => {
    const ranked = scoreOffers(earbudCriteria, earbudOffers);
    const runnerUp = ranked[1]!.offer_id;
    const cf = priceToWin(earbudCriteria, earbudOffers, runnerUp)!;
    const threshold = cf.wins_below!;

    // One cent below the threshold, the runner-up wins.
    const below = scoreOffers(earbudCriteria, reprice(earbudOffers, runnerUp, Math.round(threshold * 100 - 1) / 100));
    expect(below[0]!.offer_id).toBe(runnerUp);

    // At the threshold, it does not.
    const at = scoreOffers(earbudCriteria, reprice(earbudOffers, runnerUp, threshold));
    expect(at[0]!.offer_id).not.toBe(runnerUp);
  });

  it("holds for every non-winner across many random markets", () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let trial = 0; trial < 60; trial++) {
      const offers: ScorableOffer[] = Array.from({ length: 3 + (trial % 5) }, (_, i) => ({
        id: `o${i}`,
        name: `O${i}`,
        brand: "b",
        attributes: { price: Math.round(2000 + rand() * 18000) / 100, battery_hours: Math.round(rand() * 40), comfort: Math.round(rand() * 100) / 10 },
      }));
      const crit = [
        { key: "price", weight: 0.2 + rand(), direction: "lower" as const },
        { key: "battery_hours", weight: rand(), direction: "higher" as const },
        { key: "comfort", weight: rand(), direction: "higher" as const },
      ];
      for (const r of scoreOffers(crit, offers).slice(1)) {
        const cf = priceToWin(crit, offers, r.offer_id)!;
        if (cf.wins_below === null) continue;
        const centsBelow = Math.round(cf.wins_below * 100) - 1;
        expect(scoreOffers(crit, reprice(offers, r.offer_id, centsBelow / 100))[0]!.offer_id).toBe(r.offer_id);
        expect(scoreOffers(crit, reprice(offers, r.offer_id, cf.wins_below))[0]!.offer_id).not.toBe(r.offer_id);
      }
    }
  });

  it("is null when price is not a criterion", () => {
    const crit = earbudCriteria.filter((c) => c.key !== "price");
    expect(counterfactuals(crit, earbudOffers)).toEqual([]);
  });

  it("reports when no price can win", () => {
    const offers: ScorableOffer[] = [
      { id: "champ", name: "Champ", brand: "x", attributes: { price: 10, battery_hours: 50 } },
      { id: "weak", name: "Weak", brand: "x", attributes: { price: 20, battery_hours: 1 } },
    ];
    const crit = [
      { key: "price", weight: 0.1, direction: "lower" as const },
      { key: "battery_hours", weight: 0.9, direction: "higher" as const },
    ];
    const cf = priceToWin(crit, offers, "weak")!;
    expect(cf.wins_below).toBeNull();
    expect(cf.summary).toBe("Weak does not win at any price");
  });
});
