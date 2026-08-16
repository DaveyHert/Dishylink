import { cloudRequest, type CloudRequest, type CloudReply } from "./cloudHost";
import { AccountRequiredError } from "./routerClientUpdate";
import type { RouterConfigUpdate } from "@core/routerConfigUpdate";

export { AccountRequiredError };

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
  throw new Error(`Starlink rejected the change: ${message}`);
}
