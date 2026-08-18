// The desktop app's own settings, owned by the main process.
//
// The recorder in this process decides whether to notify with no window open,
// so a preference stored where only the renderer can read it — localStorage,
// which exists only while a window does — is no preference at all to the
// process that needs it.
//
// So it lives here, beside the recorder's data, and the renderer reaches it over
// the preload bridge like anything else it does not own. One file, read once at
// startup and rewritten on change — settings are a handful of booleans, not a
// database.

import { app } from "electron";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { normalizeIpAddress } from "../core/ipAddress";

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Preferences {
  /**
   * Whether desktop notifications are wanted.
   *
   * null means never chosen, which is emphatically not the same as chosen-off:
   * treating an absent file as "off" would silently switch alerting off for
   * someone who had actually asked for it. The window seeds this from what it
   * holds the first time it loads; until it does, the answer is unknown rather
   * than no.
   */
  notifications: boolean | null;

  /**
   * Whether the live ↓/↑ throughput readout is shown — in the macOS menu bar
   * beside the tray icon, or on the Windows taskbar. One preference, whichever
   * surface the host has. A desktop-only display choice with no history anywhere
   * else, so unlike `notifications` it is a plain boolean: nothing turns on telling
   * a default apart from a choice, and there is no older store to migrate a value
   * from. (The stored key keeps this name even though the readout isn't menu-bar
   * only — renaming it would orphan the value in existing settings files.)
   */
  menuBarThroughput: boolean;

  /**
   * The main window's last position and size, restored on launch so it reopens
   * where it was left. null until the window has moved or resized at least once.
   */
  windowBounds: WindowBounds | null;

  /**
   * Where to reach the router. null means 192.168.1.1, which is right for almost
   * every kit; a value is for the setups it cannot serve — a router whose subnet
   * was moved in the official app, or a kit in bypass mode behind a third-party
   * router. The dish has no equivalent: its 192.168.100.1 is fixed in firmware.
   *
   * Owned by main for the same reason `notifications` is: the recorder in this
   * process dials the router with no window open.
   */
  routerAddress: string | null;

  /**
   * The router's clientId for this machine, or null until the window has seen
   * itself on the roster. What the self-pause refusal matches on when the write
   * is made from off the router's network, where an address match means nothing.
   */
  selfClientId: number | null;
}

const DEFAULTS: Preferences = {
  notifications: null,
  menuBarThroughput: process.platform === "darwin",
  windowBounds: null,
  routerAddress: null,
  selfClientId: null,
};

/** A clientId is a uint32 the router issued, so anything else on disk is not one. */
function storedClientId(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff
    ? value
    : null;
}

function isWindowBounds(value: unknown): value is WindowBounds {
  if (typeof value !== "object" || value === null) return false;
  const bounds = value as Record<string, unknown>;
  return (
    typeof bounds.x === "number" &&
    typeof bounds.y === "number" &&
    typeof bounds.width === "number" &&
    typeof bounds.height === "number"
  );
}

/** A hand-edited settings file must not send this process dialling something that
 *  is not an address at all, so what comes off disk is validated like typed input. */
function storedAddress(value: unknown): string | null {
  return typeof value === "string" ? normalizeIpAddress(value) : null;
}

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
      menuBarThroughput:
        typeof parsed.menuBarThroughput === "boolean"
          ? parsed.menuBarThroughput
          : DEFAULTS.menuBarThroughput,
      windowBounds: isWindowBounds(parsed.windowBounds) ? parsed.windowBounds : null,
      routerAddress: storedAddress(parsed.routerAddress),
      selfClientId: storedClientId(parsed.selfClientId),
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
