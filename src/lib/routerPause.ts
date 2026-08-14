import { cloudRequest, type CloudRequest, type CloudReply } from "./cloudHost";

export function clientPauseControlAvailable(
  clientId: number | undefined,
  isThisDevice: boolean,
  cloudConnected: boolean,
  hostSupportsPause = true,
): boolean {
  return hostSupportsPause && cloudConnected && !isThisDevice && clientId !== undefined;
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
