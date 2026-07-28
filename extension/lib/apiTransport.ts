// The extension's binding for apiHost: the dashboard page has no origin serving
// /api, so a request crosses to the service worker over runtime messaging, which
// reads IndexedDB and answers. The reply is rebuilt into a Response so the app's
// hooks read `.ok`/`.status`/`.json()` exactly as they do on every other host.

import { browser } from "wxt/browser";
import type { ApiTransport } from "../../src/lib/apiHost";
import type { ApiReply } from "./apiRouter";

export const extensionApiTransport: ApiTransport = async (path, init) => {
  const reply = (await browser.runtime.sendMessage({
    type: "api",
    path,
    method: init?.method ?? "GET",
    body: typeof init?.body === "string" ? init.body : undefined,
  })) as ApiReply;
  return new Response(JSON.stringify(reply.body), {
    status: reply.status,
    headers: { "content-type": "application/json" },
  });
};
