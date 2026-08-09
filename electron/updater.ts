// Update checks against the GitHub Releases feed electron-builder publishes to
// (see electron-builder.yml's `publish` block). Detection only: this build is
// ad-hoc-signed on macOS and unsigned on Windows, and Squirrel.Mac/NSIS won't
// silently apply an update on either without real code signing, so
// autoDownload/autoInstallOnAppQuit stay off.

import { autoUpdater } from "electron-updater";

export interface UpdateState {
  available: boolean;
  version: string | null;
}

let state: UpdateState = { available: false, version: null };
const listeners = new Set<(state: UpdateState) => void>();

function setState(next: UpdateState): void {
  state = next;
  for (const listener of listeners) listener(state);
}

export function updateState(): UpdateState {
  return state;
}

/** Reports every later change; returns an unsubscribe. */
export function onUpdateStateChanged(listener: (state: UpdateState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Long enough not to hammer the GitHub API from a tray app that stays open for
// days; short enough that a published release reaches an open app the same day.
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Packaged builds only — checkForUpdates needs app-update.yml, which electron-builder
 *  writes into the packaged resources and which a dev run never has. */
export function startUpdateChecks(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("update-available", (info) =>
    setState({ available: true, version: info.version }),
  );
  autoUpdater.on("update-not-available", () => setState({ available: false, version: null }));
  // A failed check (offline, rate-limited, no releases published yet) leaves the
  // last known state as-is rather than surfacing an error to the user.
  autoUpdater.on("error", () => {});

  const check = (): void => void autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, CHECK_INTERVAL_MS);
}
