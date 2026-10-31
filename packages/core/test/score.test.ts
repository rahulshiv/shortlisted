import { describe, expect, it } from "vitest";
import { canonicalJson, scoreOffers, type ScorableOffer } from "../src/index.ts";
import { earbudCriteria, earbudOffers } from "./fixtures.ts";

describe("scoreOffers", () => {
  it("ranks by weighted min-max normalized attributes, respecting direction", () => {
    const ranked = scoreOffers(
      [
        { key: "price", weight: 1, direction: "lower" },
        { key: "battery_hours", weight: 1, direction: "higher" },
      ],
      [
        { id: "a", name: "A", brand: "x", attributes: { price: 100, battery_hours: 10 } },
        { id: "b", name: "B", brand: "x", attributes: { price: 50, battery_hours: 30 } },
        { id: "c", name: "C", brand: "x", attributes: { price: 75, battery_hours: 20 } },
      ],
    );
    expect(ranked.map((r) => r.offer_id)).toEqual(["b", "c", "a"]);
    expect(ranked[0]!.score).toBe(1);
    expect(ranked[1]!.score).toBe(0.5);
    expect(ranked[2]!.score).toBe(0);
  });

  it("breaks ties by offer id, independent of input order", () => {
    const offers: ScorableOffer[] = [
      { id: "zeta", name: "Z", brand: "x", attributes: { price: 10 } },
      { id: "alpha", name: "A", brand: "x", attributes: { price: 10 } },
      { id: "mid", name: "M", brand: "x", attributes: { price: 10 } },
    ];
    const crit = [{ key: "price", weight: 1, direction: "lower" as const }];
    expect(scoreOffers(crit, offers).map((r) => r.offer_id)).toEqual(["alpha", "mid", "zeta"]);
    expect(scoreOffers(crit, [...offers].reverse()).map((r) => r.offer_id)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("gives 0 for a missing attribute", () => {
    const ranked = scoreOffers(
      [{ key: "battery_hours", weight: 1, direction: "higher" }],
      [
        { id: "a", name: "A", brand: "x", attributes: {} },
        { id: "b", name: "B", brand: "x", attributes: { battery_hours: 5 } },
      ],
    );
    expect(ranked.map((r) => [r.offer_id, r.score])).toEqual([["b", 1], ["a", 0]]);
  });

  it("rejects invalid criteria", () => {
    expect(() => scoreOffers([], earbudOffers)).toThrow();
    expect(() => scoreOffers([{ key: "price", weight: -1, direction: "lower" }], earbudOffers)).toThrow();
    expect(() => scoreOffers([{ key: "price", weight: 0, direction: "lower" }], earbudOffers)).toThrow();
  });
});

describe("fee independence", () => {
  it("identical offers that paid different fees get identical scores", () => {
    // Two brands with byte-identical product data. One paid $0.02, the other $5.00.
    const catalog = [
      { offer: { id: "twin-a", name: "Twin", brand: "Twin", attributes: { price: 80, battery_hours: 30, sound_quality: 8, comfort: 8 } }, fee: 0.02 },
      { offer: { id: "twin-b", name: "Twin", brand: "Twin", attributes: { price: 80, battery_hours: 30, sound_quality: 8, comfort: 8 } }, fee: 5.0 },
      { offer: earbudOffers[0]!, fee: 0 },
    ];
    // The only way into the scorer is the fee-free `offer` half.
    const ranked = scoreOffers(earbudCriteria, catalog.map((c) => c.offer));
    const a = ranked.find((r) => r.offer_id === "twin-a")!;
    const b = ranked.find((r) => r.offer_id === "twin-b")!;
    expect(a.score).toBe(b.score);
    expect(a.contributions).toEqual(b.contributions);
  });

  it("ignores fee fields smuggled in at runtime", () => {
    const smuggled = earbudOffers.map((o, i) => ({ ...o, fee: i * 100, x402Toll: "9999", sponsored: true }));
    const clean = scoreOffers(earbudCriteria, earbudOffers);
    // Cast to bypass the compile-time guard, simulating untyped JSON input.
    const dirty = scoreOffers(earbudCriteria, smuggled as unknown as ScorableOffer[]);
    expect(canonicalJson(dirty)).toBe(canonicalJson(clean));
  });

  it("rejects fee fields at compile time", () => {
    const withFee = { id: "x", name: "X", brand: "X", attributes: { price: 1 }, fee: 0.02 };
    // @ts-expect-error: ScorableOffer forbids fee keys, so fees cannot be passed to the scorer.
    const typed: ScorableOffer = withFee;
    // @ts-expect-error: same guard on the array parameter of scoreOffers.
    scoreOffers(earbudCriteria, [{ id: "y", name: "Y", brand: "Y", attributes: { price: 1 }, toll: 1 }]);
    expect(typed).toBeDefined();
  });
});

describe("determinism", () => {
  it("produces byte-identical rankings for the same inputs, in any input order", () => {
    const runs = Array.from({ length: 5 }, (_, i) => {
      const shuffled = [...earbudOffers].sort(() => (i % 2 ? 1 : -1));
      const crit = i % 2 ? [...earbudCriteria].reverse() : earbudCriteria;
      return canonicalJson(scoreOffers(crit, shuffled));
    });
    expect(new Set(runs).size).toBe(1);
  });

  it("does not mutate its inputs", () => {
    const before = canonicalJson({ earbudCriteria, earbudOffers });
    scoreOffers(earbudCriteria, earbudOffers);
    expect(canonicalJson({ earbudCriteria, earbudOffers })).toBe(before);
  });
});
