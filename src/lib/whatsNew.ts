import type { TranslationKey } from "@core/i18n/resources";

// The newest release with highlights in the catalog. Bumped only when highlights
// are added, so a patch with nothing to announce shows nothing.
export const WHATS_NEW_RELEASE = "1.3.1";

/** One line of the notes. A row without a title carries on from the row above it. */
export interface Highlight {
  title?: TranslationKey;
  body: TranslationKey;
}

// Newest release first, the first being WHATS_NEW_RELEASE.
const HIGHLIGHTS_BY_RELEASE: { release: string; items: Highlight[] }[] = [
  {
    release: "1.3.1",
    items: [
      { title: "whatsNew.speedTitle", body: "whatsNew.speedBody" },
      { title: "whatsNew.signInTitle", body: "whatsNew.signInBody" },
      { title: "whatsNew.tiltTargetTitle", body: "whatsNew.tiltTargetBody" },
    ],
  },
  {
    release: "1.3",
    items: [
      { title: "whatsNew.languagesTitle", body: "whatsNew.languagesBody" },
      { title: "whatsNew.reportsTitle", body: "whatsNew.reportsBody" },
      { title: "whatsNew.timeFormatTitle", body: "whatsNew.timeFormatBody" },
      { title: "whatsNew.eventLogTitle", body: "whatsNew.eventLogBody" },
      { title: "whatsNew.fixesTitle", body: "whatsNew.factoryResetBody" },
      { body: "whatsNew.chartsBody" },
    ],
  },
];

/** Everything released since `lastSeen`, so nobody reads the same notes twice; an
 *  upgrade from before there were notes gets every release listed. */
export function highlightsSince(lastSeen: string | null): Highlight[] {
  const items: Highlight[] = [];
  for (const { release, items: releaseItems } of HIGHLIGHTS_BY_RELEASE) {
    if (release === lastSeen) break;
    items.push(...releaseItems);
  }
  return items;
}

const SEEN_KEY = "dishylink-whats-new-seen";
const OWN_KEY_PREFIX = "dishylink-";

function usedBefore(storage: Storage): boolean {
  for (let i = 0; i < storage.length; i++) {
    if (storage.key(i)?.startsWith(OWN_KEY_PREFIX)) return true;
  }
  return false;
}

/**
 * Whether these highlights are news to this profile. A fresh install has nothing
 * to compare against, so it is marked as having seen them rather than greeted
 * with changes to an app it never used.
 */
export function readWhatsNewDue(storage: Storage): boolean {
  const seen = storage.getItem(SEEN_KEY);
  if (seen === WHATS_NEW_RELEASE) return false;
  if (seen !== null) return true;
  if (usedBefore(storage)) return true;
  storage.setItem(SEEN_KEY, WHATS_NEW_RELEASE);
  return false;
}

// Read at module load, before React's first effects: useTheme writes its key on
// mount, which would make a fresh install look like an upgrade by the time the
// dashboard asks.
const seenAtLaunch = typeof localStorage === "undefined" ? null : localStorage.getItem(SEEN_KEY);
const dueAtLaunch = typeof localStorage !== "undefined" && readWhatsNewDue(localStorage);

/** The last release whose highlights this profile saw, as it stood at launch.
 *  Null for an upgrade from before there were highlights to see. */
export function whatsNewLastSeen(): string | null {
  return seenAtLaunch;
}

export function whatsNewDue(): boolean {
  return dueAtLaunch && localStorage.getItem(SEEN_KEY) !== WHATS_NEW_RELEASE;
}

export function markWhatsNewSeen(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SEEN_KEY, WHATS_NEW_RELEASE);
}
