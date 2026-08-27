// The extension's cloud binding, service-worker side.
//
// The account features read starlink.com over the internet, not the LAN — a
// wholly separate concern from the historian (no dish, no poll loop, its own
// auth). The request logic is the shared, host-agnostic createCloudHandler; this
// wires it to the extension's session store and network, the way the dev proxy
// wires a file and Electron the keychain:
//
//   • session store — our OWN captured copy in chrome.storage, not the browser's
//     live jar. Connect reads the jar once and hands the handler that copy;
//     disconnect deletes our copy and leaves the browser's starlink.com login
//     untouched. This mirrors every other host: connected means we hold a copy.
//   • token — the short-lived Access.V1 rotates, and a service worker cannot read
//     Set-Cookie to capture the refresh (Node can, which is how the file host
//     does it). So the fresh token is read back from the jar the refresh call
//     populates and merged over our stored session; our stored copy stays the
//     owned session, so disconnect still severs only what is ours.
//   • network — the Cookie header is appended to the worker's fetches via a
//     declarativeNetRequest rule; a cross-site service-worker fetch has cookies
//     withheld by SameSite, so credentials alone are not enough.

import { browser } from "wxt/browser";
import { createCloudHandler } from "../../cloud/starlinkCloudHandler";
import { DishClient, type DishConfigJson } from "@core/dishClient";
import { prepareDishConfigUpdate } from "@core/dishConfigUpdate";
import {
  buildRouterConfigRequest,
  readCurrentNetworks,
  readCurrentSubnet,
  readRouterWifiConfig,
  type RouterConfigUpdate,
} from "@core/routerConfigUpdate";
import {
  prepareRouterClientUpdate,
  readRouterClients,
  type RouterClientUpdate,
} from "@core/routerClientUpdate";
import type { CloudReply, CloudRequest } from "@/lib/cloudHost";
import { dishHandleUrl, routerHandleUrl } from "./endpoints";
import { loadSelfDeviceClientId } from "./selfDevice";

const SESSION_KEY = "cloudSession";

// readCookie/writeCookie are synchronous in the handler; chrome.storage is async,
// so our copy is mirrored here and reloaded before each request is served.
let ourCookie: string | null = null;
let routerPromise: Promise<DishClient> | null = null;
let dishPromise: Promise<DishClient> | null = null;
// A client holds the URL it was loaded with, so one cached across an address
// change would keep dialling the box the user just told us they had moved.
let cachedRouterUrl = "";
let cachedDishUrl = "";

/** The router client every router callback needs, reloaded whenever the address
 *  changes. The gateway callbacks need it only as a codec — loading dials nothing. */
function loadRouter(): Promise<DishClient> {
  const routerUrl = routerHandleUrl();
  if (routerUrl !== cachedRouterUrl) {
    cachedRouterUrl = routerUrl;
    routerPromise = null;
  }
  return (routerPromise ??= DishClient.load("router", { handleUrl: routerUrl }));
}

const cloudHandler = createCloudHandler({
  fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, { ...init, credentials: "include" })) as typeof fetch,
  readCookie: () => ourCookie,
  writeCookie: (cookie) => {
    ourCookie = cookie;
    void browser.storage.local.set({ [SESSION_KEY]: cookie });
  },
  clearCookie: () => {
    ourCookie = null;
    void browser.storage.local.remove(SESSION_KEY);
  },
  prepareDeviceUpdate: async (update, targetId, callGateway) =>
    prepareRouterClientUpdate(await loadRouter(), update, targetId, callGateway),
  prepareRouterConfigUpdate: async (update, targetId, callGateway) => {
    const client = await loadRouter();
    const networks = await readCurrentNetworks(update, client, targetId, callGateway);
    return client.encodeRequest(buildRouterConfigRequest(targetId, update, networks));
  },
  readRouterSubnet: async (targetId, callGateway) =>
    readCurrentSubnet(await loadRouter(), targetId, callGateway),
  readRouterClients: async (targetId, callGateway) =>
    readRouterClients(await loadRouter(), targetId, callGateway),
  readRouterConfig: async (targetId, callGateway) =>
    readRouterWifiConfig(await loadRouter(), targetId, callGateway),
  prepareDishConfigUpdate: async (changes) => {
    const dishUrl = dishHandleUrl();
    if (dishUrl !== cachedDishUrl) {
      cachedDishUrl = dishUrl;
      dishPromise = null;
    }
    dishPromise ??= DishClient.load("dish", { handleUrl: dishUrl });
    return prepareDishConfigUpdate(await dishPromise, changes);
  },
});

async function jarCookies(): Promise<{ name: string; value: string }[]> {
  return browser.cookies.getAll({ domain: "starlink.com" });
}

/** The browser's current starlink.com session as a header string — read once, at
 *  connect, to take our own copy of it. */
async function captureSession(): Promise<string> {
  return (await jarCookies()).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

/** Mirror our connection state into the sync cookie. The stored copy is what marks
 *  us connected and is all disconnect clears; while connected, the jar's current
 *  cookies are used verbatim, so a rotated token is always carried and the full
 *  set (the account host issues more than one Access.V1) is never mangled. Reading
 *  the jar never mutates it, so this stays non-destructive. */
async function loadOurCookie(): Promise<void> {
  const stored = (await browser.storage.local.get(SESSION_KEY))[SESSION_KEY] as string | undefined;
  ourCookie = stored ? await captureSession() : null;
}

// A cross-site fetch from the service worker has the starlink.com cookies withheld
// by SameSite, even with credentials and host access, so its Cookie header arrives
// empty. A session rule appends our session at the network layer — append, not
// set, is the only op DNR allows on Cookie, and appending onto an empty header
// yields exactly it. Scoped to the worker's own requests (tabIds:[-1] — no owning
// tab), so it never touches the user's real starlink.com tabs.
const COOKIE_RULE_ID = 1;

async function setCookieRule(cookie: string | null): Promise<void> {
  await browser.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [COOKIE_RULE_ID],
    addRules: cookie
      ? [
          {
            id: COOKIE_RULE_ID,
            priority: 1,
            action: {
              type: "modifyHeaders",
              requestHeaders: [{ header: "Cookie", operation: "append", value: cookie }],
            },
            condition: {
              requestDomains: ["starlink.com"],
              resourceTypes: ["xmlhttprequest"],
              tabIds: [-1],
            },
          },
        ]
      : [],
  });
}

/** Whether a session is held, so a surface can say up front whether a data limit
 *  will actually be enforced rather than only after one is not. */
export function accountSignedIn(): boolean {
  return ourCookie !== null;
}

/** Answer one /cloud/* request from the dashboard. */
export async function handleCloudRequest(request: CloudRequest): Promise<CloudReply> {
  const route = new URL(request.path, "http://extension.invalid").pathname;

  // A pause aimed at the device running this extension would cut off the session
  // needed to undo it, and the only thing that knows which device that is, is the
  // one the user named. Enforced here as well as in the control that renders it.
  if (route === "/cloud/device" && request.method === "POST") {
    const update = request.body as RouterClientUpdate;
    if (update?.kind === "rename") return cloudHandler.updateClient(update);
    if (update?.kind !== "pause")
      return { status: 501, body: { error: "unsupported_on_extension" } };
    const selfClientId = await loadSelfDeviceClientId();
    if (selfClientId === null)
      return {
        status: 409,
        body: {
          error: "self_device_unknown",
          message: "Choose this device under Settings → App before pausing others.",
        },
      };
    if (update.clientId === selfClientId)
      return {
        status: 409,
        body: {
          error: "self_pause_refused",
          message: "This is the device you are using, so it cannot be paused from here.",
        },
      };
    return cloudHandler.updateClient(update);
  }

  // Dish config carries no self-target hazard the way pausing a client does —
  // sleep schedule, update window, and defer-updates apply to the dish as a
  // whole, not to whichever device happens to be running the extension.
  if (route === "/cloud/dish-config" && request.method === "POST") {
    return cloudHandler.updateDishConfig(request.body as DishConfigJson);
  }

  // Custom DNS is router-wide, not per-client, so it carries none of the
  // self-target hazard that makes pausing unsafe on this host.
  if (route === "/cloud/router-config" && request.method === "POST") {
    return cloudHandler.updateRouterConfig(request.body as RouterConfigUpdate);
  }

  // /cloud/session is connect (capture our copy) and disconnect (drop our copy).
  if (route === "/cloud/session") {
    if (request.method === "POST") {
      // Take our own copy if there is a real session to take — gated on the SSO
      // cookie, the durable half. The connection is confirmed by the first account
      // read, not a validation fetch here: a cookie rule set microseconds earlier
      // is not reliably applied to the very next request, which read the empty jar
      // and failed. The account read runs with the rule long settled.
      const captured = await captureSession();
      if (!/Starlink\.Com\.Sso=/.test(captured)) {
        return { status: 428, body: { error: "not_connected" } };
      }
      ourCookie = captured;
      await browser.storage.local.set({ [SESSION_KEY]: captured });
      await setCookieRule(captured);
      return { status: 200, body: { ok: true } };
    }
    if (request.method === "DELETE") {
      const result = cloudHandler.disconnect();
      await setCookieRule(null);
      return result;
    }
    await loadOurCookie();
    return { status: ourCookie ? 200 : 428, body: {} };
  }

  await loadOurCookie();
  await setCookieRule(ourCookie);
  let reply = await cloudHandler.handle(route);

  // A session captured the instant it appears can carry a token that authorizes the
  // service-line call but not yet the auth host, so the account read comes back with
  // everything but identity. That read also refreshes the jar's Access.V1 as a side
  // effect; re-reading the jar and the cookie rule lets one more read carry the fresh
  // token, landing Name/Email without waiting for a manual reload. Only a 200 that is
  // missing identity qualifies — a 428 has no session to refresh.
  if (
    route === "/cloud/account" &&
    reply.status === 200 &&
    (reply.body as { identity?: unknown }).identity === null
  ) {
    await loadOurCookie();
    await setCookieRule(ourCookie);
    reply = await cloudHandler.handle(route);
  }

  return reply;
}
