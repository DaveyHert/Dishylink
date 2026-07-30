// Flattens the account's terminals and their routers into the single ordered
// list the device picker shows: active dishes first, each followed by its own
// routers, with everything inactive grouped at the bottom.
//
// Pure, and separated because the ordering and the stable-key rule are the
// substance — the picker itself is a map over the result.

import {
  dishDisplayName,
  routerDisplayName,
  dishStatus,
  routerStatus,
  dishTelemetryId,
  routerTelemetryId,
  type CloudTerminal,
  type CloudRouter,
  type DeviceStatus,
  type DeviceTelemetry,
  type RouterTelemetry,
} from "../../lib/starlinkCloud";

export interface DeviceItem {
  key: string;
  kind: "dish" | "router";
  name: string;
  status: DeviceStatus;
  /** True for an inactive dish and every router under it — grouped at the bottom. */
  groupInactive: boolean;
  terminal?: CloudTerminal;
  router?: CloudRouter;
  tel?: DeviceTelemetry;
}

export function buildDeviceList(
  terminals: CloudTerminal[],
  deviceTelemetry: Record<string, DeviceTelemetry>,
  /** Cloud DeviceIds answering on this LAN — see lanPresence. Devices in here
   *  are judged live rather than by the cloud's ~2-minute-old telemetry; an
   *  empty set (away from the network) simply leaves every dot to the cloud. */
  lanOnline: ReadonlySet<string> = new Set(),
): DeviceItem[] {
  const active: DeviceItem[] = [];
  const inactive: DeviceItem[] = [];
  terminals.forEach((terminal, terminalIndex) => {
    const dishId = dishTelemetryId(terminal);
    const tel = deviceTelemetry[dishId];
    const status = dishStatus(terminal, tel, lanOnline.has(dishId));
    const groupInactive = status === "inactive";
    const bucket = groupInactive ? inactive : active;
    bucket.push({
      // Stable key: falling back to a fresh random id every render remounts the
      // whole subtree each pass and feeds a render loop.
      key: terminal.userTerminalId ?? `dish-${terminalIndex}`,
      kind: "dish",
      name: dishDisplayName(terminal),
      status,
      groupInactive,
      terminal,
      tel,
    });
    const routerItems: DeviceItem[] = (terminal.routers ?? []).map((router, routerIndex) => {
      const routerId = routerTelemetryId(router.routerId);
      const rtel = deviceTelemetry[routerId] as RouterTelemetry | undefined;
      return {
        key: router.routerId ?? `router-${terminalIndex}-${routerIndex}`,
        kind: "router",
        name: routerDisplayName(router.routerId, rtel),
        status: routerStatus(rtel, groupInactive, lanOnline.has(routerId)),
        groupInactive,
        router,
        tel: rtel,
      };
    });
    // Online routers above offline ones under the same dish.
    routerItems.sort((a, b) => (a.status === "online" ? 0 : 1) - (b.status === "online" ? 0 : 1));
    bucket.push(...routerItems);
  });
  return [...active, ...inactive];
}
