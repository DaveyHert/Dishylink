// Resolves the viewing device's own address(es) once while the network surface
// is open, so NetworkPanel can flag "This device". See lib/selfIdentity for the
// backends. Kept separate from useRouterNetwork: it doesn't poll and doesn't
// depend on the router being reachable.

import { useEffect, useState } from "react";
import { resolveSelfIdentity, type SelfIdentity } from "../lib/selfIdentity";

const EMPTY: SelfIdentity = { ips: [], macs: [], describesHost: false };

/** `resolved` separates "no identity" from "not asked yet", which a surface that
 *  reacts to an unknown viewer must not show for the first frame. */
export function useSelfIdentity(): { self: SelfIdentity; resolved: boolean } {
  const [identity, setIdentity] = useState<{ self: SelfIdentity; resolved: boolean }>({
    self: EMPTY,
    resolved: false,
  });

  useEffect(() => {
    const controller = new AbortController();
    void resolveSelfIdentity(controller.signal).then((self) => {
      if (!controller.signal.aborted) setIdentity({ self, resolved: true });
    });
    return () => controller.abort();
  }, []);

  return identity;
}
