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
  chrome: "https://chromewebstore.google.com/detail/dishylink/pljgamnkfokhbchiiommnblkjffffnna",
  edge: null,
  firefox: null,
};

export interface DownloadOption {
  id: string;
  label: string;
  href: string | null;
  fileType: string;
  size: string | null;
  logo?: string;
}

export interface DownloadPlatform {
  id: string;
  label: string;
  icon: "windows" | "apple" | "browsers";
  choiceLabel: string;
  requirement: string;
  options: DownloadOption[];
}

interface ReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

// Read from the newest *published* release rather than package.json: the version
// is bumped and pushed before the draft is published, so package.json names
// assets that do not exist yet and every download button would 404.
async function fetchLatestRelease(): Promise<{ tag: string; assets: ReleaseAsset[] } | null> {
  try {
    const response = await fetch(
      "https://api.github.com/repos/DaveyHert/dishylink/releases/latest",
      { headers: { accept: "application/vnd.github+json" } },
    );
    if (!response.ok) return null;
    const release = await response.json();
    if (typeof release?.tag_name !== "string") return null;
    return { tag: release.tag_name, assets: Array.isArray(release.assets) ? release.assets : [] };
  } catch {
    return null;
  }
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 * 10
    ? `${Math.round(bytes / 1024 / 1024)} MB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export async function downloadPlatforms(fallbackVersion: string): Promise<{
  version: string;
  platforms: DownloadPlatform[];
}> {
  const release = await fetchLatestRelease();
  const version = release ? release.tag.replace(/^v/, "") : fallbackVersion;
  const assets = release?.assets ?? [];

  // Matched by shape rather than by rebuilding the filename, so a change to
  // electron-builder's artifactName cannot silently produce dead buttons.
  const find = (pattern: RegExp): ReleaseAsset | undefined =>
    assets.find((asset) => pattern.test(asset.name));

  const option = (
    id: string,
    label: string,
    pattern: RegExp,
    fileType: string,
    fallbackName: string,
  ): DownloadOption => {
    const asset = find(pattern);
    return {
      id,
      label,
      fileType,
      href:
        asset?.browser_download_url ?? `${GITHUB}/releases/download/v${version}/${fallbackName}`,
      size: asset ? formatSize(asset.size) : null,
    };
  };

  const storeOption = (id: string, label: string, pattern: RegExp): DownloadOption => {
    const asset = find(pattern);
    return {
      id,
      label,
      logo: `/browsers/${id}.svg`,
      fileType: STORES[id] ? "Store" : "ZIP",
      href: STORES[id] ?? asset?.browser_download_url ?? null,
      size: STORES[id] ? null : asset ? formatSize(asset.size) : null,
    };
  };

  return {
    version,
    platforms: [
      {
        id: "macos",
        label: "macOS",
        icon: "apple",
        choiceLabel: "CPU architecture",
        requirement: "macOS 12 or later",
        options: [
          option("arm64", "ARM64", /-arm64\.dmg$/, "DMG", `Dishylink-${version}-arm64.dmg`),
          option("x64", "x64", /-x64\.dmg$/, "DMG", `Dishylink-${version}-x64.dmg`),
        ],
      },
      {
        id: "windows",
        label: "Windows",
        icon: "windows",
        choiceLabel: "CPU architecture",
        requirement: "Windows 10 or later",
        options: [
          option(
            "universal",
            "Universal",
            /^Dishylink-[\d.]+\.exe$/,
            "EXE",
            `Dishylink-${version}.exe`,
          ),
          option("x64", "x64", /-x64\.exe$/, "EXE", `Dishylink-${version}-x64.exe`),
          option("arm64", "ARM64", /-arm64\.exe$/, "EXE", `Dishylink-${version}-arm64.exe`),
        ],
      },
      {
        id: "web",
        label: "Browser",
        icon: "browsers",
        choiceLabel: "Browser",
        requirement: "Chrome 144+, Edge, Firefox",
        options: [
          storeOption("chrome", "Chrome", /-chrome\.zip$/),
          storeOption("edge", "Edge", /-edge\.zip$/),
          storeOption("firefox", "Firefox", /-firefox\.zip$/),
        ],
      },
    ],
  };
}

export const SITE = {
  name: "Dishylink",
  domain: "dishylink.com",
  tagline: "Know exactly what your dish is doing",
};
