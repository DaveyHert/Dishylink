// The release the catalog's whatsNew highlights describe. Bumped only when the
// highlights are rewritten, so a patch release doesn't show the same notes twice.
export const WHATS_NEW_RELEASE = "1.3";

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
const dueAtLaunch = typeof localStorage !== "undefined" && readWhatsNewDue(localStorage);

export function whatsNewDue(): boolean {
  return dueAtLaunch && localStorage.getItem(SEEN_KEY) !== WHATS_NEW_RELEASE;
}

export function markWhatsNewSeen(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SEEN_KEY, WHATS_NEW_RELEASE);
}
