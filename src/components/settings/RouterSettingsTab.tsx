// Router information and maintenance — the Router half of the settings panel.
// Read-mostly by design: the one write here is a reboot.

import { useMemo, useState } from "react";
import { Callout } from "@/components/ui/callout";
import { Loading } from "@/components/ui/loading";
import { DishClient, type WifiNetworkConfigJson } from "@core/dishClient";
import type { RouterUnreachable } from "../../lib/routerDiagnosis";
import { Badge } from "@/components/ui/badge";
import { CollapsibleSection, DangerAction, SectionLabel, SettingRow } from "./settingsChrome";
import { RouterAddressRow } from "./RouterAddressRow";
import { CustomDnsSection } from "./CustomDnsSection";
import { SubnetSection } from "./SubnetSection";
import { BypassSection } from "./BypassSection";
import type { CloudAccount } from "../../lib/starlinkCloud";
import { routerAddressForSubnet } from "@core/routerConfigUpdate";
import { routerAddressHost } from "../../lib/routerAddressHost";
import { applyRouterConfigUpdate } from "../../lib/routerConfigUpdate";
import { useCloudAccount, useCloudRouterSubnet } from "../../hooks/useCloudAccount";
import { useRouterAddressState } from "../../hooks/useRouterAddress";
import { routerPresence } from "@core/routerPresence";
import type { DishStatusJson } from "@core/dishClient";

/** SSIDs with the bands each is broadcast on. One network can appear on several
 *  radios, so they are folded by name rather than listed once per radio. */
function ssidsWithBands(wifiConfig: WifiNetworkConfigJson | null): [string, string[]][] {
  const sets = wifiConfig?.networks?.flatMap((network) => network.basicServiceSets ?? []) ?? [];
  const byName = new Map<string, string[]>();
  for (const set of sets) {
    if (!set.ssid) continue;
    const bands = byName.get(set.ssid) ?? [];
    if (set.band) {
      bands.push(
        set.band.replace("RF_", "").replace("GHZ", " GHz").replace("5 GHz_HIGH", "5 GHz hi"),
      );
    }
    byName.set(set.ssid, bands);
  }
  return [...byName.entries()];
}

/** The controller's bypass state, or null when the account has not said. A mesh
 *  node reports as a router too and is never the bypassed one, so the controller
 *  is picked the way the cloud handler picks its write target: zero hops. */
function controllerBypassed(account: CloudAccount | null): boolean | null {
  for (const device of Object.values(account?.deviceTelemetry ?? {})) {
    if (device.kind === "router" && device.hops === 0) return device.isBypassed ?? null;
  }
  return null;
}

export function RouterSettingsTab({
  wifiConfig,
  dishStatus,
  routerReachable,
  viaAccount,
  unreachable,
  onConfigChanged,
}: {
  wifiConfig: WifiNetworkConfigJson | null;
  dishStatus: DishStatusJson | null;
  routerReachable: boolean | null;
  /** Whether `wifiConfig` was read through the account because the LAN could not
   *  serve it. What it says is the same either way; what still cannot be done
   *  from here is anything that dials the router directly. */
  viaAccount: boolean;
  /** Why the router is silent, when it is. Null while it is answering. */
  unreachable: RouterUnreachable | null;
  /** For a write that leaves the router up, which nothing else would re-read.
   *  A write that takes it down is covered by the read on its return instead. */
  onConfigChanged: () => void;
}) {
  const ssids = useMemo(() => ssidsWithBands(wifiConfig), [wifiConfig]);
  const meshNodes = Object.values(wifiConfig?.meshConfigs ?? {});
  const [addresses, setAddresses] = useRouterAddressState();
  // The DNS and subnet writes have no local path, so the controls are disabled up
  // front rather than failing at the moment Save is pressed.
  const account = useCloudAccount(true);
  const accountConnected = account.status === "ready";
  // A store still on its first read says nothing either way, and the retry loop
  // keeps flicking it back through "loading", so the first answer is remembered.
  const [accountAnswered, setAccountAnswered] = useState(false);
  if (!accountAnswered && account.status !== "loading") setAccountAnswered(true);
  // Read from the account rather than the router: a bypassed router answers
  // nothing on the LAN, so `wifiConfig` is silent exactly when the answer is yes.
  const bypassed = controllerBypassed(account.data);
  // Whichever read landed already carries it; the dedicated subnet route is only
  // for when neither did.
  const configSubnet = wifiConfig?.networks?.[0]?.ipv4 ?? null;
  const { data: cloudSubnet, reload: rereadCloudSubnet } = useCloudRouterSubnet(
    accountConnected && configSubnet === null,
  );
  // Only the rows that ask the router something wait on it. The address is how a
  // silent router gets found again, so it stays live through every state below.
  const answering = routerReachable !== null && !unreachable && wifiConfig !== null;
  // What the config says is worth showing however it arrived — and the writes
  // beside it go through the account, not the LAN, so they were never waiting on
  // the router to answer here in the first place.
  const configKnown = wifiConfig !== null && (answering || viaAccount);
  const showDns = configKnown && !wifiConfig?.customDnsDisabled;

  return (
    <>
      {routerReachable === null && <Loading message='Contacting the router…' />}
      {/* Branch on the diagnosis rather than on `routerReachable` again: it is
          derived from that same flag, so this cannot render an empty callout. */}
      {unreachable && <Callout tone='error'>{unreachable.message}</Callout>}

      {configKnown && (
        <>
          <SectionLabel>Networks</SectionLabel>
          {ssids.map(([ssid, bands]) => (
            <SettingRow
              key={ssid}
              title={ssid}
              caption='WPA2 · password managed in the Starlink app'
            >
              {[...new Set(bands)].map((band) => (
                <Badge key={band}>{band}</Badge>
              ))}
            </SettingRow>
          ))}

          {meshNodes.length > 0 && (
            <>
              <SectionLabel>Mesh nodes</SectionLabel>
              {meshNodes.map((node, nodeIndex) => (
                <SettingRow
                  key={nodeIndex}
                  title={node.displayName ?? "Mesh node"}
                  caption={node.hardwareVersion ? `hardware ${node.hardwareVersion}` : undefined}
                >
                  <Badge tone={node.auth !== "MESH_AUTH_TRUSTED" ? "critical" : "neutral"}>
                    {node.auth === "MESH_AUTH_TRUSTED" ? "trusted" : (node.auth ?? "unknown")}
                  </Badge>
                </SettingRow>
              ))}
            </>
          )}

          {wifiConfig?.boot?.evenSideSoftwareVersion && (
            <SettingRow
              title='Router firmware'
              caption={`country ${wifiConfig.countryCode ?? "—"}`}
            >
              <span className='font-mono text-[12px] text-muted-foreground tabular-nums'>
                {wifiConfig.boot.evenSideSoftwareVersion}
              </span>
            </SettingRow>
          )}
        </>
      )}

      <SectionLabel>Maintenance</SectionLabel>
      <DangerAction
        title='Reboot router'
        caption={
          answering
            ? "WiFi drops for a minute or two; the dish stays up"
            : "Unavailable until the router answers"
        }
        buttonLabel='Reboot'
        slideLabel='Slide to reboot router'
        confirmLabel='Reboot router'
        disabled={!answering}
        onRun={async () => {
          const routerClient = await DishClient.load("router");
          await routerClient.reboot();
          return "Reboot sent — the router is restarting.";
        }}
      />
      <DangerAction
        title='Factory reset router'
        caption={
          answering || accountConnected
            ? "Wipes the WiFi name, password and every router setting. Not reversible."
            : "Needs the router on this network, or your Starlink account"
        }
        buttonLabel='Factory reset'
        slideLabel='Slide to factory reset the router'
        confirmLabel='Factory reset router'
        warning='Factory reset will clear your WiFi network name, password, and other settings. This will interrupt your service until you set it up again.'
        disabled={!answering && !accountConnected}
        onRun={async () => {
          // A bypassed router is off the LAN, which is exactly when a reset is
          // wanted: the account reaches it there and nothing local does.
          if (!answering) {
            await applyRouterConfigUpdate({ kind: "factoryReset" });
            return "Factory reset sent through your Starlink account — the router is wiping and restarting.";
          }
          await (await DishClient.load("router")).factoryReset();
          return "Factory reset sent — the router is wiping and restarting.";
        }}
      />
      <CollapsibleSection title='Advanced'>
        {addresses && (
          <>
            <SectionLabel>Connection</SectionLabel>
            <RouterAddressRow
              addresses={addresses}
              onChanged={(next) => {
                setAddresses(next);
                onConfigChanged();
              }}
            />
          </>
        )}
        {showDns && (
          <>
            <SectionLabel>DNS</SectionLabel>
            <CustomDnsSection
              nameservers={wifiConfig?.nameservers ?? []}
              disabled={!accountConnected}
              onSave={async (nameservers) => {
                await applyRouterConfigUpdate({ kind: "customDns", nameservers });
                onConfigChanged();
              }}
            />
          </>
        )}
        <SectionLabel>Network</SectionLabel>
        <SubnetSection
          currentSubnet={configSubnet ?? cloudSubnet}
          disabled={!accountConnected}
          onSave={async (subnet, password) => {
            await applyRouterConfigUpdate({ kind: "subnet", password, subnet });
            // The router is about to answer somewhere else, and this is the
            // setting that decides where the app looks for it.
            const updatedAddresses = await routerAddressHost()?.write(
              routerAddressForSubnet(subnet),
            );
            if (updatedAddresses?.ok) setAddresses(updatedAddresses.addresses);
            rereadCloudSubnet();
          }}
        />
        <SectionLabel>Bypass</SectionLabel>
        <BypassSection
          reported={bypassed}
          routerAnswering={answering}
          dishPresence={routerPresence(dishStatus)}
          // A failed read is not an absent session, and bypass is what fails reads.
          disabled={!accountAnswered || account.status === "not-connected"}
          accountAnswering={accountConnected}
          onReload={account.reload}
          onSave={async (enabled) => {
            await applyRouterConfigUpdate({ kind: "bypass", enabled });
          }}
        />
      </CollapsibleSection>
    </>
  );
}
