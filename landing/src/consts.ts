// Every outbound link on the site, in one place — the store listings do not
// exist yet, so they are marked and rendered as "coming soon" rather than as
// dead buttons. Fill these in and the buttons activate on their own.

export const GITHUB = "https://github.com/DaveyHert/dishylink";
export const RELEASES = `${GITHUB}/releases/latest`;
export const ISSUES = `${GITHUB}/issues`;
export const PRIVACY = `${GITHUB}/blob/master/PRIVACY.md`;
export const X = "https://x.com/daveyhert";

/** Cloudflare Email Routing address; forwards to the verified destination. */
export const EMAIL = "hello@dishylink.com";

export const SPONSOR = {
  github: "https://github.com/sponsors/daveyhert",
  patreon: "https://www.patreon.com/DaveyHert",
  coffee: "https://buymeacoffee.com/daveyhert",
};

/** null = listing not published yet; the UI renders a disabled control instead. */
export const STORES: Record<string, string | null> = {
  chrome: null,
  edge: null,
  firefox: null,
};

export const DOWNLOADS: Record<string, string | null> = {
  mac: null,
  windows: null,
};

export const SITE = {
  name: "Dishylink",
  domain: "dishylink.com",
  tagline: "Know exactly what your dish is doing",
};
