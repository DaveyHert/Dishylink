// Builds the device drill-in's spec sheet: every fact the router exposes about
// one client, in display order, skipping whatever it did not report.
//
// Separated from the rendering because the ordering and the "is this worth a
// row?" rules are the substance here — the list itself is a map over the result.

import { createElement, type ReactNode } from "react";
import type { TFunction } from "i18next";
import type { WifiClientJson } from "@core/dishClient";
import type { ClientUsageTotal } from "@core/clientUsage";
import { formatBytes, formatUptime } from "../../lib/format";
import { bandLabel, IDLE_AFTER_S, type SignalQuality } from "./networkFormat";

export interface DeviceFact {
  key: string;
  label: string;
  value: ReactNode;
}

export function buildDeviceFacts({
  client,
  quality,
  vendor,
  upstreamName,
  total,
  t,
}: {
  client: WifiClientJson;
  quality: SignalQuality | null;
  vendor?: string;
  /** Resolved name of the node this client is attached to. */
  upstreamName?: string;
  /** This device's monthly usage from the historian's odometer, if it has one. */
  total?: ClientUsageTotal;
  t: TFunction;
}): DeviceFact[] {
  // noDataIdleS is the router's own "seconds since this device last passed
  // traffic"; proto3 omits it at zero, so absent means traffic right now.
  // Observed live, it oscillates a few seconds on devices with background
  // chatter, so the threshold sits well clear of that rather than flapping
  // between active and idle every poll.
  const idleSeconds = client.noDataIdleS ?? 0;
  const linkRx = client.rxStats?.rateMbps;
  const linkTx = client.txStats?.rateMbps;
  // Cumulative counters since the client associated — everything over the radio,
  // which is what a device total means here. uploadMb/downloadMb count a
  // narrower quantity; see WifiClientJson.
  const rxBytes = Number(client.rxStats?.bytes ?? 0);
  const txBytes = Number(client.txStats?.bytes ?? 0);

  const facts: DeviceFact[] = [
    {
      key: "status",
      label: t("network.factStatus"),
      value:
        idleSeconds < IDLE_AFTER_S
          ? t("network.factActive")
          : t("network.factIdle", { duration: formatUptime(idleSeconds, t) }),
    },
  ];
  if (client.role) facts.push({ key: "role", label: t("network.role"), value: client.role });
  if (upstreamName)
    facts.push({ key: "connectedTo", label: t("network.connectedTo"), value: upstreamName });
  // Always shown. A randomized MAC carries no vendor, so the row reads "Private"
  // as the app's does — an absent row just looks broken.
  facts.push({
    key: "manufacturer",
    label: t("network.manufacturer"),
    value: vendor ?? t("common.unknownCapitalised"),
  });
  facts.push({ key: "connection", label: t("network.connection"), value: bandLabel(client) });
  if (quality) {
    facts.push({
      key: "signal",
      label: t("terminal.signal"),
      value: createElement(
        "span",
        { style: { color: `var(${quality.colorVar})` } },
        client.iface === "ETH"
          ? t("network.wired")
          : t("network.signalValue", { dbm: client.signalStrength, quality: t(quality.label) }),
      ),
    });
  }
  if (client.snr !== undefined && client.snr > 0) {
    facts.push({ key: "snr", label: t("network.snr"), value: `${client.snr} dB` });
  }
  if (client.channelWidth) {
    facts.push({
      key: "bandwidth",
      label: t("network.bandwidth"),
      value: `${client.channelWidth} MHz`,
    });
  }
  if (client.rxStats?.mcs !== undefined) {
    facts.push({ key: "mcs", label: t("network.mcs"), value: client.rxStats.mcs });
  }
  if (client.rxStats?.nss !== undefined) {
    facts.push({ key: "nss", label: t("network.nss"), value: client.rxStats.nss });
  }
  if (linkRx) facts.push({ key: "rx", label: t("network.rxRate"), value: `${linkRx} Mbps` });
  if (linkTx) facts.push({ key: "tx", label: t("network.txRate"), value: `${linkTx} Mbps` });
  if (client.ipAddress) facts.push({ key: "ipv4", label: "IPv4", value: client.ipAddress });
  if (client.ipv6Addresses && client.ipv6Addresses.length > 0) {
    facts.push({
      key: "ipv6",
      label: "IPv6",
      value: createElement("span", { className: "text-[11px]" }, client.ipv6Addresses[0]),
    });
  }
  if (client.macAddress)
    facts.push({ key: "mac", label: t("network.macAddress"), value: client.macAddress });
  if (client.associatedTimeS) {
    facts.push({
      key: "connectedFor",
      label: t("network.connectedFor"),
      value: formatUptime(client.associatedTimeS, t),
    });
  }
  if (total && (total.rxBytes > 0 || total.txBytes > 0)) {
    // The historian's odometer: a real monthly total that survives the reconnects
    // the router's own counter resets on. Preferred whenever it exists.
    facts.push({
      key: "dataUsage",
      label: t("network.dataUsedMonth"),
      value: `${formatBytes(total.rxBytes)} ↓ / ${formatBytes(total.txBytes)} ↑`,
    });
  } else if (rxBytes > 0 || txBytes > 0) {
    // No odometer yet (historian off, or a device just seen): the router's raw
    // counter, which resets on every reconnect — labelled so it never reads as a
    // lifetime or monthly total.
    facts.push({
      key: "dataUsage",
      label: t("network.dataUsedConnection"),
      value: `${formatBytes(rxBytes)} ↓ / ${formatBytes(txBytes)} ↑`,
    });
  }
  return facts;
}
