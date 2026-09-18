export type ReviewStore = "chrome" | "edge" | "firefox";

const STORE_NAME: Record<ReviewStore, string> = {
  chrome: "Chrome Web Store",
  edge: "Edge Add-ons",
  firefox: "Firefox Add-ons",
};

// Edge has no /reviews route; it 404s, so Edge lands on the listing.
const REVIEW_URL: Record<ReviewStore, string> = {
  chrome:
    "https://chromewebstore.google.com/detail/dishylink/pljgamnkfokhbchiiommnblkjffffnna/reviews",
  edge: "https://microsoftedge.microsoft.com/addons/detail/pknccegejhlgmeiojalenedmkbcaimdo",
  firefox: "https://addons.mozilla.org/addon/dishylink/reviews/",
};

// Undefined in the web and Electron builds, which never define it.
function buildTarget(): string | undefined {
  return (import.meta.env as Record<string, string | undefined>).BROWSER;
}

export function reviewStore(): ReviewStore | null {
  if (typeof window !== "undefined" && window.dishlink) return null;

  const target = buildTarget();
  if (target === "firefox") return "firefox";
  if (target === "edge") return "edge";
  if (target !== "chrome") return null;

  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return ua.includes("Edg/") ? "edge" : "chrome";
}

export function reviewStoreName(store: ReviewStore): string {
  return STORE_NAME[store];
}

export function reviewUrl(store: ReviewStore): string {
  return REVIEW_URL[store];
}
