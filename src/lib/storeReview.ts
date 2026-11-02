/** "site" is dishylink.com/review, for the builds no store lists: desktop and web. */
export type ReviewStore = "chrome" | "edge" | "firefox" | "site";

// Edge has no /reviews route; it 404s, so Edge lands on the listing.
const REVIEW_URL: Record<Exclude<ReviewStore, "site">, string> = {
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
  if (typeof window !== "undefined" && window.dishlink) return "site";

  const target = buildTarget();
  if (target === "firefox") return "firefox";
  if (target === "edge") return "edge";
  if (target !== "chrome") return "site";

  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return ua.includes("Edg/") ? "edge" : "chrome";
}

export function reviewUrl(store: ReviewStore): string {
  if (store !== "site") return REVIEW_URL[store];
  return `https://dishylink.com/review/?from=${sitePlatform()}`;
}

// Recorded with the review so it can be shown as from the Mac or Windows app.
function sitePlatform(): string {
  if (typeof window === "undefined" || !window.dishlink) return "web";
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (ua.includes("Mac")) return "mac";
  if (ua.includes("Windows")) return "windows";
  return "linux";
}
