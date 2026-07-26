// Router information and maintenance — the Router half of the settings sheet.
// Read-mostly by design: the one write here is a reboot.

import { useMemo } from "react";
import { Callout } from "@/components/ui/callout";
import { Loading } from "@/components/ui/loading";
import {
  DishClient,
  ROUTER_UNREACHABLE_MESSAGE,
  type WifiNetworkConfigJson,
} from "../../lib/dishClient";
import { Badge } from "@/components/ui/badge";
import { DangerAction, SectionLabel, SettingRow } from "./settingsChrome";

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

export function RouterSettingsTab({
  wifiConfig,
  routerReachable,
}: {
  wifiConfig: WifiNetworkConfigJson | null;
  routerReachable: boolean | null;
}) {
  const ssids = useMemo(() => ssidsWithBands(wifiConfig), [wifiConfig]);
  const meshNodes = Object.values(wifiConfig?.meshConfigs ?? {});

  if (routerReachable === null) return <Loading message='Contacting the router…' />;
  if (routerReachable === false)
    return <Callout tone='error'>{ROUTER_UNREACHABLE_MESSAGE}</Callout>;
  if (!wifiConfig) return null;

  return (
    <>
      <SectionLabel>Networks</SectionLabel>
      {ssids.map(([ssid, bands]) => (
        <SettingRow key={ssid} title={ssid} caption='WPA2 · password managed in the Starlink app'>
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

      {wifiConfig.boot?.evenSideSoftwareVersion && (
        <SettingRow title='Router firmware' caption={`country ${wifiConfig.countryCode ?? "—"}`}>
          <span className='font-mono text-[12px] text-muted-foreground tabular-nums'>
            {wifiConfig.boot.evenSideSoftwareVersion}
          </span>
        </SettingRow>
      )}

      <SectionLabel>Maintenance</SectionLabel>
      <DangerAction
        title='Reboot router'
        caption='WiFi drops for a minute or two; the dish stays up'
        buttonLabel='Reboot'
        confirmLabel='Yes, reboot router'
        onRun={async () => {
          const routerClient = await DishClient.load("router");
          await routerClient.reboot();
          return "Reboot sent — the router is restarting.";
        }}
      />
      <Callout className='mt-3.5'>
        Custom DNS, bypass mode, and content filtering are intentionally not exposed here — a bad
        write can take your WiFi down until a physical reset. Use the official app for those.
      </Callout>
    </>
  );
}
