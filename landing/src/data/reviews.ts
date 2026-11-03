import snapshot from "./reviews.json";
import { STORES } from "../constants";

// Written by scripts/fetch-reviews.mjs — refresh with `npm run reviews` and
// commit the JSON rather than editing it by hand.

export type ReviewSource =
  | "chrome"
  | "firefox"
  | "edge"
  | "supporter"
  | "producthunt"
  | "youtube"
  | "reddit"
  | "bandaancha"
  | "site";

export interface Review {
  id: string;
  source: ReviewSource;
  name: string;
  /** Null for Buy Me a Coffee notes, which carry no rating. */
  stars: number | null;
  text: string;
  date: string;
  url: string;
  /** Site path to the reviewer's photo, or to a drawn face when they have none. */
  avatar: string;
  /** Set when `text` is our English translation; the page says so beside the quote. */
  translatedFrom?: string;
  /** Which app a dishylink.com review was sent from, e.g. "Mac app". */
  via?: string | null;
  /** ISO country code. Only Edge publishes one; every other source leaves it out. */
  country?: string | null;
}

export const reviews = snapshot.reviews as Review[];

/** Faces for reviews that came with no words: shown in the grid, not clickable. */
export const silentFaces: string[] = snapshot.silent;

/** Supporters have no logo file: they use the sponsor menu's CoffeeIcon, which follows the theme. */
export const SOURCES: Record<ReviewSource, { label: string; logo?: string }> = {
  chrome: { label: "Chrome Web Store", logo: "/browsers/chrome.svg" },
  firefox: { label: "Firefox Add-ons", logo: "/browsers/firefox.svg" },
  edge: { label: "Edge Add-ons", logo: "/browsers/edge.svg" },
  supporter: { label: "Supporter" },
  producthunt: { label: "Product Hunt", logo: "/producthunt.svg" },
  youtube: { label: "YouTube", logo: "/youtube.svg" },
  reddit: { label: "Reddit", logo: "/reddit.svg" },
  bandaancha: { label: "BandaAncha", logo: "/bandaancha.svg" },
  site: { label: "dishylink.com", logo: "/favicon.svg" },
};

/** Where a visitor goes to leave one. Edge has no reviews route, so it lands on the listing. */
const storePage = (id: string, path = "") => (STORES[id] ? `${STORES[id]}${path}` : null);

export const reviewLinks = [
  { label: "Chrome", href: storePage("chrome", "/reviews") },
  { label: "Firefox", href: storePage("firefox", "reviews/") },
  { label: "Edge", href: storePage("edge") },
].filter((link): link is { label: string; href: string } => link.href !== null);

const storeRatings = Object.values(snapshot.ratings).filter((r) => r.count > 0);
const storeCount = storeRatings.reduce((sum, r) => sum + r.count, 0);

// Reviews left on dishylink.com carry stars too, so they count toward the average.
const siteStars = reviews.filter((r) => r.source === "site" && r.stars !== null);

export const rating = {
  // One per face in the grid: every quote, plus every rating, coffee and comment shown without words.
  count: reviews.length + silentFaces.length,
  average:
    (storeRatings.reduce((sum, r) => sum + r.average * r.count, 0) +
      siteStars.reduce((sum, r) => sum + (r.stars ?? 0), 0)) /
    (storeCount + siteStars.length),
};
