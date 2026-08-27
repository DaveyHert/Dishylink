// Explains a failing router poll to the surfaces that have to say something
// about it — the Network panel and the Settings modal's Router tab — so both
// give the same account of the same failure.
//
// Only while the router is actually silent: resolving the viewer's own address
// costs a request, and there is nothing to explain while the router answers.

import { useEffect, useMemo, useState } from "react";
import { ROUTER_LAN_ADDRESS, type DishStatusJson } from "@core/dishClient";
import { routerPresence } from "@core/routerPresence";
import { resolveSelfIdentity, type SelfIdentity } from "../lib/selfIdentity";
import {
  diagnoseRouterUnreachable,
  viewerOnRouterSubnet,
  type RouterUnreachable,
} from "../lib/routerDiagnosis";
import { useRouterAddressState } from "./useRouterAddress";

/**
 * How long the router must stay silent before the specific causes are allowed.
 *
 * The causes worth naming are all structural — an address taken by another
 * router, a kit in bypass, the wrong network — and none of them heals on its
 * own. An outage does. Waiting past the point where an outage would have
 * cleared means a reboot or a dropped link never gets described as a wiring
 * problem the user should go and fix.
 *
 * Long enough to cover the window where the router poll has already failed but
 * the dish poll (1s, 4s timeout) has not yet caught up and withdrawn the
 * evidence the diagnosis leans on.
 */
const SILENCE_BEFORE_DIAGNOSIS_MS = 15_000;

/**
 * The reason the router is unreachable, or `null` while it is answering or
 * still being probed for the first time.
 *
 * Takes the dish's own reply rather than fetching anything from the router: the
 * dish is the only witness that can say a router exists when we cannot reach it.
 */
export function useRouterUnreachable(
  routerReachable: boolean | null,
  dishStatus: DishStatusJson | null,
  dishReachable: boolean,
): RouterUnreachable | null {
  /** null until resolved, and again once the router comes back: an address read
   *  during one outage is no longer evidence during the next, which may well be
   *  on a different network. */
  const [identity, setIdentity] = useState<SelfIdentity | null>(null);
  /** Timed rather than counted in polls, so it does not shift with the poll
   *  interval. */
  const [silencePersisted, setSilencePersisted] = useState(false);
  const unreachable = routerReachable === false;

  useEffect(() => {
    if (!unreachable) return;
    const controller = new AbortController();
    // Resolved immediately rather than after the wait, so the specific wording
    // is ready the moment it is allowed and the callout changes text once.
    void resolveSelfIdentity(controller.signal).then((resolved) => {
      if (!controller.signal.aborted) setIdentity(resolved);
    });
    const diagnosisTimer = setTimeout(() => setSilencePersisted(true), SILENCE_BEFORE_DIAGNOSIS_MS);
    return () => {
      controller.abort();
      clearTimeout(diagnosisTimer);
      // The outage this was resolved during is over, so drop it rather than
      // let it seed the next one — which may be on a different network.
      setIdentity(null);
      setSilencePersisted(false);
    };
  }, [unreachable]);

  // Both signals collapse to a tri-state before the memo, so the diagnosis keeps
  // one identity across the dish polls underneath it — the status object is new
  // every second, and a fresh message object each time would re-render the
  // callout showing it for no change in what it says.
  const presence = dishReachable ? routerPresence(dishStatus) : null;
  // Only addresses belonging to the machine that makes the router request say
  // anything about why that request failed. A phone viewing this dashboard over
  // the LAN is answered with its own address, which is not where the request
  // comes from, so it is no evidence and the diagnosis stays general.
  // The address actually being dialled, so the wording names what failed rather
  // than the default this host may not be using. Whether it was chosen matters
  // too: silence at a typed address points at the setting, not the network.
  const [addresses] = useRouterAddressState();
  const routerAddress = addresses?.router ?? ROUTER_LAN_ADDRESS;
  const addressConfigured = Boolean(addresses?.router);
  const onRouterSubnet = viewerOnRouterSubnet(
    identity?.describesHost ? identity.ips : undefined,
    routerAddress,
  );

  return useMemo(
    () =>
      unreachable
        ? diagnoseRouterUnreachable(
            { presence, onRouterSubnet, addressConfigured, silencePersisted },
            routerAddress,
          )
        : null,
    [unreachable, silencePersisted, presence, onRouterSubnet, addressConfigured, routerAddress],
  );
}
