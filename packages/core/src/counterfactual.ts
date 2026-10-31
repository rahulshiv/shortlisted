import { scoreOffers } from "./score.ts";
import type { Counterfactual, Criterion, ScorableOffer } from "./types.ts";

const PRICE_KEY = "price";

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** True if `targetId` ranks first when its price is set to `cents`/100. */
function winsAt(criteria: readonly Criterion[], offers: readonly ScorableOffer[], targetId: string, cents: number): boolean {
  const repriced = offers.map((o) =>
    o.id === targetId ? { ...o, attributes: { ...o.attributes, [PRICE_KEY]: cents / 100 } } : o,
  );
  return scoreOffers(criteria, repriced)[0]?.offer_id === targetId;
}

/**
 * The price at which `targetId` would take first place, holding everything else fixed.
 *
 * Lowering the target's price can only raise its own normalized price score and can
 * only lower everyone else's (the min/max range widens or shifts in its favor), so
 * "wins at price p" is monotone in p and a binary search over whole cents is exact.
 * The result is still confirmed by re-running the scorer at the boundary.
 */
export function priceToWin(
  criteria: readonly Criterion[],
  offers: readonly ScorableOffer[],
  targetId: string,
): Counterfactual | null {
  if (!criteria.some((c) => c.key === PRICE_KEY && c.weight > 0)) return null;
  const ranked = scoreOffers(criteria, offers);
  const leader = ranked[0];
  const target = offers.find((o) => o.id === targetId);
  const price = target?.attributes[PRICE_KEY];
  if (!leader || !target || price === undefined || leader.offer_id === targetId) return null;

  const currentCents = Math.round(price * 100);
  const base = {
    kind: "price_to_win" as const,
    offer_id: target.id,
    name: target.name,
    versus_offer_id: leader.offer_id,
    current_price: price,
  };

  if (currentCents <= 1 || !winsAt(criteria, offers, targetId, 1)) {
    return { ...base, wins_below: null, summary: `${target.name} does not win at any price` };
  }
  // Invariant: wins at lo, does not win at hi.
  let lo = 1;
  let hi = currentCents;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (winsAt(criteria, offers, targetId, mid)) lo = mid;
    else hi = mid;
  }
  // `hi` is the first price (in cents) where it stops winning, so it wins at every price below it.
  const winsBelow = hi / 100;
  return { ...base, wins_below: winsBelow, summary: `${target.name} wins below ${formatUsd(winsBelow)}` };
}

/** Counterfactuals for a ranking. In v0 that is the runner-up's price-to-win. */
export function counterfactuals(criteria: readonly Criterion[], offers: readonly ScorableOffer[]): Counterfactual[] {
  const ranked = scoreOffers(criteria, offers);
  const runnerUp = ranked[1];
  if (!runnerUp) return [];
  const cf = priceToWin(criteria, offers, runnerUp.offer_id);
  return cf ? [cf] : [];
}
