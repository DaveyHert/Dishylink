// The desktop app's own settings, owned by the main process.
//
// The notifications preference used to live in renderer localStorage, which
// exists only while a window does. That was survivable while the renderer was
// also the thing deciding to notify; now that the recorder in this process makes
// that call with no window open, a preference the deciding process cannot read
// is no preference at all.
//
// So it lives here, beside the recorder's data, and the renderer reaches it over
// the preload bridge like anything else it does not own. One file, read once at
// startup and rewritten on change — settings are a handful of booleans, not a
// database.

import { app } from "electron";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

export interface Preferences {
  /**
   * Whether desktop notifications are wanted.
   *
   * null means never chosen, which is emphatically not the same as chosen-off.
   * This setting used to live in the window's localStorage, so someone who
   * turned notifications on in an earlier build has a preference recorded
   * somewhere this process cannot read. Treating an absent file as "off" would
   * silently switch alerting off for exactly the people who had asked for it.
   * The window seeds this from what it holds the first time it loads; until it
   * does, the answer is unknown rather than no.
   */
  notifications: boolean | null;
}

const DEFAULTS: Preferences = { notifications: null };

let cached: Preferences | null = null;

function file(): string {
  return join(app.getPath("userData"), "preferences.json");
}

export function preferences(): Preferences {
  if (cached) return cached;
  try {
    const parsed = JSON.parse(readFileSync(file(), "utf8")) as Partial<Preferences>;
    // Merged over the defaults so a file written by an older build — or one
    // hand-edited into nonsense — cannot leave a field undefined. Only a real
    // boolean counts as a choice; anything else stays unknown.
    cached = {
      ...DEFAULTS,
      notifications: typeof parsed.notifications === "boolean" ? parsed.notifications : null,
    };
  } catch {
    // No file yet, or unreadable. Either way the defaults are the answer.
    cached = { ...DEFAULTS };
  }
  return cached;
}

/**
 * Called after any preference changes, with the settings as they now stand.
 *
 * A setting can be shown in more than one place at once — notifications have a
 * tray checkbox and a control in the alerts panel — and `preferences()` hands out
 * a snapshot that cannot tell its holder it has gone stale. So a surface that
 * displays a preference subscribes here and is written from the change, rather
 * than reading once and keeping a copy of the answer.
 */
type PreferencesListener = (preferences: Preferences) => void;

const listeners = new Set<PreferencesListener>();

export function onPreferencesChanged(listener: PreferencesListener): void {
  listeners.add(listener);
}

export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
  const next = { ...preferences(), [key]: value };
  cached = next;
  try {
    writeFileSync(file(), JSON.stringify(next, null, 2));
  } catch {
    // Non-fatal: the setting holds for this run and reverts on the next launch,
    // which is better than taking the app down over a settings write.
  }
  // Announced even if that write failed: the cache is what `preferences()`
  // answers with, so it is what the app is acting on and what its controls
  // should be showing.
  for (const listener of listeners) listener(next);
}
