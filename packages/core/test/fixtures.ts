import type { Criterion, ScorableOffer } from "../src/index.ts";

export const earbudCriteria: Criterion[] = [
  { key: "price", weight: 0.3, direction: "lower" },
  { key: "battery_hours", weight: 0.3, direction: "higher" },
  { key: "sound_quality", weight: 0.25, direction: "higher" },
  { key: "comfort", weight: 0.15, direction: "higher" },
];

export const earbudOffers: ScorableOffer[] = [
  { id: "eb-novasound-air", name: "NovaSound Air", brand: "NovaSound", attributes: { price: 79, battery_hours: 32, sound_quality: 8.4, comfort: 8.6 } },
  { id: "eb-kestrel-one", name: "Kestrel One", brand: "Kestrel", attributes: { price: 89, battery_hours: 36, sound_quality: 8.5, comfort: 8.0 } },
  { id: "eb-acmebuds-pro", name: "AcmeBuds Pro", brand: "AcmeBuds", attributes: { price: 95, battery_hours: 30, sound_quality: 8.7, comfort: 8.1 } },
  { id: "eb-tempo-lite", name: "Tempo Lite", brand: "Tempo", attributes: { price: 49, battery_hours: 24, sound_quality: 7.2, comfort: 7.8 } },
];
