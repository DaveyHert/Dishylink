// Best-effort guess at a device's form factor from the name it shows in the UI
// (the hostname it reports, or its vendor when it reports none).
//
// The MAC vendor (OUI) gives the brand but not the shape — an Apple OUI is on a
// Mac, an iPhone, an iPad and a Watch alike — so the name is the only signal that
// distinguishes them, and only when it carries a type word. A user may rename a
// device to a single word ("TV", "PS5", "Console", "Phone"), so matching works on
// whole-word tokens as well as substrings; a blank or opaque name (a bare MAC, a
// random hostname) carries nothing and falls back to a generic glyph.

export type DeviceKind =
  "phone" | "laptop" | "desktop" | "tablet" | "watch" | "tv" | "console" | "light" | "unknown";

// Most-specific first — "Galaxy Watch"/"Galaxy Tab" must beat the "galaxy" phone
// hint, "Apple TV" must beat "apple".
//
// `tokens` match a whole word, so a rename to "TV" or "PS5" resolves. `text`
// matches anywhere, which is what catches a multi-word brand ("apple tv") or a
// name run together ("iPhone15" is a single token, so only the substring finds
// it). A `text` entry must therefore be distinctive enough to never appear inside
// an unrelated name: "iphone" and "xiaomi" are safe, a short generic word like
// "phone" or "vivo" is not — it would claim "headphones" and "VivoBook". Those
// stay tokens only. Consoles likewise match "nintendo", not the word "switch",
// which on a network panel is more often a switch.
const KIND_RULES: { kind: DeviceKind; tokens: string[]; text: string[] }[] = [
  { kind: "watch", tokens: ["watch"], text: ["applewatch", "apple watch", "galaxy watch"] },
  {
    kind: "tablet",
    tokens: ["ipad", "tablet", "kindle"],
    text: ["ipad", "galaxy tab", "surface pro"],
  },
  {
    kind: "tv",
    tokens: ["tv", "roku", "chromecast", "firestick", "shield", "appletv"],
    text: [
      "apple tv",
      "apple-tv",
      "fire tv",
      "firetv",
      "chromecast",
      "roku",
      "nvidia shield",
      "bravia",
      "vizio",
      "webos",
      "smart tv",
      "smarttv",
      "google tv",
    ],
  },
  // Ahead of "console" — a rename like "Console Lamp" is a lamp near a console,
  // not the console itself.
  {
    kind: "light",
    tokens: ["lamp", "light", "led"],
    text: [],
  },
  {
    kind: "console",
    tokens: ["console", "ps5", "ps4", "ps3", "xbox", "playstation"],
    text: ["playstation", "nintendo", "xbox", "steam deck", "steamdeck"],
  },
  {
    kind: "phone",
    tokens: [
      "phone",
      "iphone",
      "android",
      "pixel",
      "galaxy",
      "oneplus",
      "oppo",
      "vivo",
      "moto",
      "nokia",
    ],
    text: [
      "iphone",
      "android",
      "pixel",
      "oneplus",
      "xiaomi",
      "redmi",
      "huawei",
      "oppo",
      "motorola",
      "nokia",
    ],
  },
  {
    kind: "laptop",
    tokens: ["laptop", "macbook", "notebook", "thinkpad", "chromebook", "xps"],
    text: [
      "macbook",
      "laptop",
      "notebook",
      "thinkpad",
      "chromebook",
      "zenbook",
      "ideapad",
      "spectre",
      "elitebook",
    ],
  },
  {
    kind: "desktop",
    tokens: ["imac", "desktop", "pc", "workstation", "macmini", "macstudio"],
    text: [
      "imac",
      "mac mini",
      "mac-mini",
      "macmini",
      "mac studio",
      "macstudio",
      "desktop",
      "workstation",
    ],
  },
];

export function classifyDevice(name?: string): DeviceKind {
  const raw = (name ?? "").toLowerCase().trim();
  if (raw === "") return "unknown";
  const tokens = new Set(raw.split(/[^a-z0-9]+/).filter(Boolean));
  for (const rule of KIND_RULES) {
    if (
      rule.tokens.some((token) => tokens.has(token)) ||
      rule.text.some((text) => raw.includes(text))
    ) {
      return rule.kind;
    }
  }
  return "unknown";
}
