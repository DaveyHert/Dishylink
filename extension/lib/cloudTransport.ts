// The extension's cloud binding, page side: the dashboard has no origin serving
// /cloud/*, so a request crosses to the service worker (which holds the session
// and reaches starlink.com) over runtime messaging, mirroring the /api seam.

import { browser } from "wxt/browser";
import { noteCloudSessionChanged } from "@/lib/cloudHost";
import type { CloudReply, CloudSignIn, CloudTransport } from "@/lib/cloudHost";

export const extensionCloudTransport: CloudTransport = async ({ path, method, body }) => {
  // The AbortSignal cannot cross messaging; the worker answers one request and a
  // caller that has moved on drops the reply, as the desktop bridge does.
  return (await browser.runtime.sendMessage({ type: "cloud", path, method, body })) as CloudReply;
};

const CONNECT = { path: "/cloud/session", method: "POST" } as const;

// After sign-in sends the user to starlink.com, the extension has to notice the
// session appear on its own — otherwise "connected" waits on a second click back
// here. The watch is page-side on purpose: the service worker is torn down within
// ~30s of idle, so it is gone while the user is completing OTP, and a top-level
// cookies listener that could wake it would fire on every cookie change in the
// browser. The dashboard, by contrast, is already open — it is the only thing that
// needs updating — so it polls the worker (which reads the cookie jar) until the
// session lands, then announces it.
const SIGN_IN_POLL_MS = 2_000;
const SIGN_IN_POLL_TIMEOUT_MS = 5 * 60_000;
let signInPoll: ReturnType<typeof setInterval> | undefined;

function stopSignInWatch(): void {
  if (signInPoll !== undefined) {
    clearInterval(signInPoll);
    signInPoll = undefined;
  }
}

/** Poll for the session the sign-in tab is about to create. The first poll that
 *  connects announces it — which reloads the panel to the account — and stops.
 *  Bounded so an abandoned sign-in doesn't poll forever; a fresh sign-in replaces
 *  the watch rather than stacking a second one. */
function watchForSignIn(): void {
  stopSignInWatch();
  const startedAt = Date.now();
  signInPoll = setInterval(() => {
    void (async () => {
      if (Date.now() - startedAt > SIGN_IN_POLL_TIMEOUT_MS) {
        stopSignInWatch();
        return;
      }
      try {
        // A POST with no session yet answers 428 without a write, so polling it is
        // free until the moment the session exists and it captures.
        const reply = await extensionCloudTransport(CONNECT);
        if (reply.status === 200) {
          stopSignInWatch();
          noteCloudSessionChanged();
        }
      } catch {
        // sendMessage rejects while the worker is mid-restart; the next tick asks
        // again. Its restarts are frequent here — each poll wakes it and it idles
        // back out — so swallowing this is the difference between a working watch
        // and a stream of unhandled rejections.
      }
    })();
  }, SIGN_IN_POLL_MS);
}

const ACCOUNT_URL = "https://www.starlink.com/account";

/**
 * Bring starlink.com to the front.
 *
 * The dashboard runs in a popup window of its own, so a tab opened from here
 * lands in a normal window behind it. Selecting that tab does not raise its
 * window — that takes a second call — and until the window is raised the user
 * sees nothing happen at all.
 *
 * Any starlink.com tab counts, not only one on the account URL: the sign-in flow
 * walks through several pages, and a user part way through wants that page back.
 */
async function showAccountTab(): Promise<void> {
  try {
    const tabs = await browser.tabs.query({ url: "https://*.starlink.com/*" });
    // Newest first. `query` returns tabs in window order, not recency, so where a
    // stale starlink.com tab sits alongside one mid sign-in, taking the first
    // would raise whichever happens to be leftmost.
    const [open] = tabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
    if (open?.id !== undefined) {
      await browser.tabs.update(open.id, { active: true });
      if (open.windowId !== undefined)
        await browser.windows.update(open.windowId, { focused: true });
      return;
    }
  } catch {
    // Reading tabs is refused on this browser; opening one still works.
  }
  const created = await browser.tabs.create({ url: ACCOUNT_URL, active: true });
  if (created.windowId !== undefined)
    await browser.windows.update(created.windowId, { focused: true }).catch(() => {});
}

/** Sign-in captures the browser's starlink.com session into the extension's own
 *  store. If the user is already signed in there, that is one silent step; if not,
 *  open starlink.com so they can — and watch for the session to appear, so the
 *  panel connects on its own once they finish, with no second click. */
export const extensionCloudSignIn: CloudSignIn = async () => {
  stopSignInWatch(); // this attempt supersedes any watch a previous one left running
  const reply = await extensionCloudTransport(CONNECT);
  if (reply.status === 200) return { ok: true };
  await showAccountTab();
  watchForSignIn();
  return { ok: false, message: "Sign in on the starlink.com tab — this connects automatically." };
};
