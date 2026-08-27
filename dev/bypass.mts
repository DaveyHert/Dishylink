// Turn bypass on or off without the app.
//
// The UI's bypass control is gated on a live account read, so a failed read
// leaves the one thing that undoes bypass unusable. This talks to the same
// cloud handler the app does, with the same session file, and needs no window.
//
//   npx tsx dev/bypass.mts off
//   npx tsx dev/bypass.mts on

import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createCloudHandler } from "../cloud/starlinkCloudHandler.ts";
import { resilientFetch } from "../cloud/resilientFetch.ts";
import { DishClient, ROUTER_LAN_HANDLE_URL } from "../core/dishClient.ts";
import { buildRouterConfigRequest, readCurrentNetworks } from "../core/routerConfigUpdate.ts";

const COOKIE_FILE = resolve(process.cwd(), ".starlink-cookie");

function readCookie(): string | null {
  try {
    return readFileSync(COOKIE_FILE, "utf8").trim() || null;
  } catch {
    return null;
  }
}

const wanted = process.argv[2];
if (wanted !== "on" && wanted !== "off") {
  console.error("usage: npx tsx dev/bypass.mts <on|off>");
  process.exit(2);
}

if (!readCookie()) {
  console.error(`No session in ${COOKIE_FILE}. Sign in through the app first.`);
  process.exit(1);
}

let routerPromise: Promise<DishClient> | null = null;
const loadRouter = () =>
  (routerPromise ??= DishClient.load("router", {
    handleUrl: ROUTER_LAN_HANDLE_URL,
    protosetBytes: new Uint8Array(readFileSync(resolve(process.cwd(), "public/dish.protoset"))),
  }));

const handler = createCloudHandler({
  fetch: resilientFetch,
  readCookie,
  writeCookie: (cookie: string) => writeFileSync(COOKIE_FILE, cookie, "utf8"),
  clearCookie: () => {
    try {
      rmSync(COOKIE_FILE);
    } catch {
      /* already gone */
    }
  },
  prepareRouterConfigUpdate: async (update, targetId, callGateway) => {
    const client = await loadRouter();
    const networks = await readCurrentNetworks(update, client, targetId, callGateway);
    return client.encodeRequest(buildRouterConfigRequest(targetId, update, networks));
  },
});

const enabled = wanted === "on";
console.log(`Sending bypass ${wanted}…`);
const { status, body } = await handler.updateRouterConfig({ kind: "bypass", enabled });
// A write that lands kills the network carrying its own reply, so the handler
// reports 200 for a deadline it could not have heard the far end refuse.
console.log(`HTTP ${status} ${JSON.stringify(body)}`);
console.log(
  status === 200
    ? "Sent. Watch the dish's downstreamRouters role to see it take effect."
    : "Not sent. Run it again; the session or the route may have been mid-change.",
);
process.exit(status === 200 ? 0 : 1);
