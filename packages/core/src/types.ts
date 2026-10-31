/**
 * Core types. Nothing in this package performs I/O, reads the clock, or calls a model.
 */

export type Direction = "higher" | "lower";

export interface Criterion {
  /** Attribute key on the offer, e.g. "price" or "battery_hours". */
  key: string;
  /** Non-negative weight. Weights are normalized to sum to 1 before scoring. */
  weight: number;
  /** Whether a larger value is better ("higher") or a smaller one is ("lower"). */
  direction: Direction;
}

/**
 * Keys that describe money paid to Shortlisted. They are forbidden on anything
 * the scorer can see. Adding a key here makes the compiler reject it on ScorableOffer.
 */
export type FeeKey =
  | "fee"
  | "fees"
  | "toll"
  | "tollAmount"
  | "toll_amount"
  | "paid"
  | "payment"
  | "payments"
  | "bid"
  | "x402"
  | "x402Toll"
  | "sponsored";

type NoFees = { readonly [K in FeeKey]?: never };

/**
 * The only shape scoreOffers accepts. It carries no information about payments,
 * and the type system rejects any object literal that tries to add one.
 */
export type ScorableOffer = NoFees & {
  readonly id: string;
  readonly name: string;
  readonly brand: string;
  /** Numeric attributes, including "price" when price is a criterion. */
  readonly attributes: Readonly<Record<string, number>>;
};

export interface Contribution {
  key: string;
  raw: number | null;
  normalized: number;
  weight: number;
  points: number;
}

export interface ScoredOffer {
  rank: number;
  offer_id: string;
  name: string;
  brand: string;
  /** Weighted sum in [0, 1]. */
  score: number;
  contributions: Contribution[];
}

export interface Counterfactual {
  kind: "price_to_win";
  offer_id: string;
  name: string;
  /** The current winner it would overtake. */
  versus_offer_id: string;
  current_price: number;
  /** The offer ranks #1 at any price strictly below this value (in whole cents). Null if no price wins. */
  wins_below: number | null;
  summary: string;
}

export const SCORER_NAME = "shortlisted-scorer";
export const SCORER_VERSION = "0.1.0";
