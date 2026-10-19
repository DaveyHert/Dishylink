// The dashboard page's own dish and router traffic, carried to the worker that
// owns the odometer. The page reaches both boxes directly, so its calls ride the
// same Wi-Fi as the worker's and the router bills them to the same device.

import { browser } from "wxt/browser";
import type { GrpcWebCallBytes } from "@core/grpcWeb";

/** Batched: the page polls the roster at 5 Hz, and a message per call would cost
 *  more than the traffic it reports. */
const FLUSH_INTERVAL_MS = 5_000;

let pending = { receivedBytes: 0, sentBytes: 0 };
let timer: ReturnType<typeof setInterval> | null = null;

function flush(): void {
  if (pending.receivedBytes === 0 && pending.sentBytes === 0) return;
  const batch = pending;
  pending = { receivedBytes: 0, sentBytes: 0 };
  void browser.runtime.sendMessage({ type: "selfTraffic", ...batch }).catch(() => {});
}

export function reportSelfTraffic({ requestBytes, responseBytes }: GrpcWebCallBytes): void {
  pending.receivedBytes += responseBytes;
  pending.sentBytes += requestBytes;
  timer ??= setInterval(flush, FLUSH_INTERVAL_MS);
}
