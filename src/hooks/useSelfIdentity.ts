// Resolves the viewing device's own address(es) once while the network surface
// is open, so NetworkPanel can flag "This device". See lib/selfIdentity for the
// backends. Kept separate from useRouterNetwork: it doesn't poll and doesn't
// depend on the router being reachable.

import { useEffect, useState } from "react";
import { resolveSelfIdentity, type SelfIdentity } from "../lib/selfIdentity";

const EMPTY: SelfIdentity = { ips: [], macs: [], describesHost: false };

export function useSelfIdentity(active: boolean): SelfIdentity {
  const [identity, setIdentity] = useState<SelfIdentity>(EMPTY);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void resolveSelfIdentity(controller.signal).then((resolved) => {
      if (!controller.signal.aborted) setIdentity(resolved);
    });
    return () => controller.abort();
  }, [active]);

  return identity;
}
