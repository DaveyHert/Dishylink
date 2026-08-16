import { cloudRequest, type CloudRequest, type CloudReply } from "./cloudHost";
import type { RouterClientUpdate } from "@core/routerClientUpdate";

/** "Not this device" and "could not tell which device you are" both arrive as
 *  `isThisDevice: false`, so `viewerIdentified` is what keeps an unresolved
 *  identity from offering to pause every row including the viewer's own. A paused
 *  device cannot undo its own pause; recovery needs a second machine. */
export function clientPauseControlAvailable(options: {
  clientId: number | undefined;
  isThisDevice: boolean;
  viewerIdentified: boolean;
  cloudConnected: boolean;
}): boolean {
  return (
    options.cloudConnected &&
    options.viewerIdentified &&
    !options.isThisDevice &&
    options.clientId !== undefined
  );
}

/** No session, so nothing was sent. Surfaces as its own type because the fix is
 *  an action the user can take here rather than a fault to report. */
export class AccountRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountRequiredError";
  }
}

/** Send one client update through Starlink cloud. The existing network roster
 *  refresh reflects the resulting router state; this path deliberately performs
 *  no additional LAN polling. */
export async function applyRouterClientUpdate(
  update: RouterClientUpdate,
  request: (request: CloudRequest) => Promise<CloudReply> = cloudRequest,
): Promise<void> {
  const reply = await request({ path: "/cloud/device", method: "POST", body: update });
  if (reply.status === 200) return;
  const message = (reply.body as { message?: string })?.message ?? `HTTP ${reply.status}`;
  if (reply.status === 428) throw new AccountRequiredError(message);
  // 409 is a host refusing before anything left this machine, so its own message
  // is the whole answer.
  if (reply.status === 409) throw new Error(message);
  throw new Error(`Starlink rejected the device update: ${message}`);
}

export async function setRouterClientPaused(clientId: number, paused: boolean): Promise<void> {
  await applyRouterClientUpdate({ kind: "pause", clientId, paused });
}

export async function setRouterClientName(clientId: number, givenName: string): Promise<void> {
  await applyRouterClientUpdate({ kind: "rename", clientId, givenName });
}
