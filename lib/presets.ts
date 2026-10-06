/* ============================================================
   PRESETS

   Each item is a garment or piece of gear. Positions are the printable
   spots on it. Prices are suggestions; athletes edit everything in the
   builder. Pairs count as one position so nobody buys half a panel.

   Prices are whole dollars here and become cents the moment a campaign
   is created. Nothing downstream handles a dollar float.
   ============================================================ */

export type PresetPosition = { name: string; size: string; price: number };
export type PresetItem = {
  key: string;
  name: string;
  sub: string;
  positions: PresetPosition[];
};

export const ITEMS: PresetItem[] = [
  { key: "trisuit", name: "Tri suit", sub: "one piece", positions: [
    { name: "Chest", size: "20 x 8 cm", price: 400 },
    { name: "Back", size: "25 x 25 cm", price: 750 },
    { name: "Shoulders (both)", size: "8 x 8 cm each", price: 300 },
    { name: "Thighs (both)", size: "10 x 10 cm each", price: 350 } ] },
  { key: "shirt", name: "Shirt / jersey", sub: "top", positions: [
    { name: "Chest", size: "20 x 8 cm", price: 400 },
    { name: "Back", size: "25 x 25 cm", price: 750 },
    { name: "Sleeves (both)", size: "8 x 8 cm each", price: 300 } ] },
  { key: "shorts", name: "Shorts / tights", sub: "bottom", positions: [
    { name: "Thighs (both)", size: "10 x 10 cm each", price: 350 },
    { name: "Back waistband", size: "12 x 4 cm", price: 150 } ] },
  { key: "dress", name: "Dress / skirt", sub: "one piece", positions: [
    { name: "Chest", size: "18 x 7 cm", price: 350 },
    { name: "Back", size: "22 x 22 cm", price: 650 },
    { name: "Hem (both sides)", size: "10 x 5 cm each", price: 250 } ] },
  { key: "hat", name: "Hat / cap", sub: "head", positions: [
    { name: "Front", size: "8 x 5 cm", price: 250 },
    { name: "Sides (both)", size: "5 x 5 cm each", price: 200 },
    { name: "Back", size: "6 x 4 cm", price: 150 } ] },
  { key: "helmet", name: "Helmet", sub: "head", positions: [
    { name: "Sides (both)", size: "6 x 6 cm each", price: 250 },
    { name: "Back", size: "6 x 4 cm", price: 150 } ] },
  { key: "bike", name: "Bike", sub: "frame decals", positions: [
    { name: "Down tube", size: "30 x 5 cm", price: 500 },
    { name: "Top tube", size: "25 x 4 cm", price: 400 },
    { name: "Fork (both)", size: "8 x 4 cm each", price: 200 } ] },
];

export const SPORTS = [
  "Running", "Cycling", "Triathlon", "Swimming", "Climbing", "Rowing", "Other",
] as const;

export const SPORT_DEFAULTS: Record<string, string[]> = {
  Running: ["shirt", "shorts", "hat"],
  Cycling: ["shirt", "shorts", "helmet", "bike"],
  Triathlon: ["trisuit", "helmet", "bike"],
  Swimming: ["shirt", "hat"],
  Climbing: ["shirt", "shorts", "hat"],
  Rowing: ["shirt", "shorts", "hat"],
  Other: ["shirt"],
};

/** Limits enforced in the builder and again on the server. */
export const MAX_POSITIONS = 24;
export const MIN_PRICE_DOLLARS = 1;
export const MAX_PRICE_DOLLARS = 50_000;
