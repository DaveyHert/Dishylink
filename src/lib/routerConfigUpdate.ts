import { cloudRequest, type CloudRequest, type CloudReply } from "./cloudHost";
import { AccountRequiredError } from "./routerClientUpdate";
import type { RouterConfigUpdate } from "@core/routerConfigUpdate";

export { AccountRequiredError };

/** Starlink holds no session to the router, so it could not pass the change on.
 *  The request was fine and nothing was applied: only time changes the answer. */
export class DeviceUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceUnreachableError";
  }
}

/** Send a router config change through Starlink cloud. There is no LAN path for
 *  this: the router answers PERMISSION_DENIED to a local set_config, and the
 *  cloud gateway reaches a bypassed router the local network cannot see at all. */
export async function applyRouterConfigUpdate(
  update: RouterConfigUpdate,
  request: (request: CloudRequest) => Promise<CloudReply> = cloudRequest,
): Promise<void> {
  const reply = await request({ path: "/cloud/router-config", method: "POST", body: update });
  if (reply.status === 200) return;
  const message = (reply.body as { message?: string })?.message ?? `HTTP ${reply.status}`;
  if (reply.status === 428) throw new AccountRequiredError(message);
  // Only the far end can refuse, and on a timeout it never spoke. The body
  // already words that case, so it stands on its own.
  if (reply.status === 504) throw new Error(message);
  if ((reply.body as { deviceUnreachable?: boolean })?.deviceUnreachable)
    throw new DeviceUnreachableError(
      "Starlink can't reach your router right now, so it couldn't pass the change on. " +
        "This clears on its own, usually within 4 to 5 minutes. Try again then.",
    );
  throw new Error(`Starlink couldn't apply the change: ${message}`);
}
