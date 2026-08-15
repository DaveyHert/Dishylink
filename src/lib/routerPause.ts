import { cloudRequest, type CloudRequest, type CloudReply } from "./cloudHost";

/** "Not your device" and "could not tell which device you are" both arrive as
 *  `isThisDevice: false`, so `viewerIdentified` is what keeps an unresolved
 *  identity from offering to pause every row including the viewer's own. A paused
 *  device cannot undo its own pause; recovery needs a second machine. */
export function clientPauseControlAvailable(options: {
  clientId: number | undefined;
  isThisDevice: boolean;
  viewerIdentified: boolean;
  cloudConnected: boolean;
  hostSupportsPause?: boolean;
}): boolean {
  return (
    (options.hostSupportsPause ?? true) &&
    options.cloudConnected &&
    options.viewerIdentified &&
    !options.isThisDevice &&
    options.clientId !== undefined
  );
}

/** Send one pause/unpause request through Starlink cloud. The existing network
 *  roster refresh reflects the resulting router state; this path deliberately
 *  performs no additional LAN polling. */
export async function applyRouterClientPaused(
  clientId: number,
  paused: boolean,
  request: (request: CloudRequest) => Promise<CloudReply> = cloudRequest,
): Promise<void> {
  const reply = await request({
    path: "/cloud/device",
    method: "POST",
    body: { clientId, paused },
  });
  if (reply.status !== 200) {
    const message = (reply.body as { message?: string })?.message ?? `HTTP ${reply.status}`;
    throw new Error(`Starlink rejected the device update: ${message}`);
  }
}

export async function setRouterClientPaused(clientId: number, paused: boolean): Promise<void> {
  await applyRouterClientPaused(clientId, paused);
}
