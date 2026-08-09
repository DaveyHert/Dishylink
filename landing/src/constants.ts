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

// Resolved from the newest *published* release rather than package.json: the
// version is bumped and pushed before the draft is published, so package.json
// names assets that do not exist yet and every download button would 404.
export async function latestVersion(fallback: string): Promise<string> {
  try {
    const response = await fetch(
      "https://api.github.com/repos/DaveyHert/dishylink/releases/latest",
      {
        headers: { accept: "application/vnd.github+json" },
      },
    );
    if (!response.ok) return fallback;
    const tag = (await response.json())?.tag_name;
    return typeof tag === "string" ? tag.replace(/^v/, "") : fallback;
  } catch {
    return fallback;
  }
}

export function downloadsFor(version: string) {
  const base = `${GITHUB}/releases/download/v${version}`;
  return {
    macArm: `${base}/Dishylink-${version}-arm64.dmg`,
    macIntel: `${base}/Dishylink-${version}-x64.dmg`,
    windows: `${base}/Dishylink-${version}.exe`,
  };
}

export const SITE = {
  name: "Dishylink",
  domain: "dishylink.com",
  tagline: "Know exactly what your dish is doing",
};
