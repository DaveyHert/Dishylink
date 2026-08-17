// Naming and classification helpers shared across the network panel's list rows
// and both drill-ins. Pure functions over a router client entry — no rendering,
// so the row, the node detail and the device detail all read a device the same
// way rather than each deriving its own label.

import { throughputMbps, type WifiClientJson } from "@core/dishClient";
import { usageKey } from "@core/clientUsage";
import { vendorForMac } from "../../lib/macVendor";
import type { ThroughputRates } from "@core/throughputTracker";

/** Silence past this reads as idle. Live polling shows noDataIdleS bouncing
 *  between 1s and 5s on devices doing nothing but background chatter. */
export const IDLE_AFTER_S = 30;

/** Seeded per-device history is one point per minute, so only a stretch past a
 *  couple of minutes is a real hole — 30s would fracture a healthy line. */
export const PER_DEVICE_GAP_MS = 150_000;

/** Windows for the per-device throughput charts. The hook retains 6h, so every
 *  option is already in memory; older points are the historian's per-minute
 *  seed, recent ones the per-second live tail. */
export const WINDOW_OPTIONS = [
  { label: "15M", value: "15" },
  { label: "1H", value: "60" },
  { label: "6H", value: "360" },
];

/** How long to hold a pause control pending before calling the write unapplied.
 *  The roster is what confirms it landed, so a deadline shorter than the roster's
 *  own cadence reports a failure the very next read denies. */
export function pauseSettleTimeoutMs(rosterRefreshMs: number): number {
  return Math.max(20_000, rosterRefreshMs * 2 + 5_000);
}

export function bandLabel(client: WifiClientJson): string {
  const iface = client.iface ?? "";
  if (iface === "ETH") return "Ethernet";
  // Named after the band, not the enum: RF_2GHZ is the 2.4 GHz band, and
  // stripping the underscores alone rendered it as a nonexistent "2 GHz".
  if (iface === "RF_2GHZ") return "2.4 GHz";
  if (iface.startsWith("RF_5GHZ")) return "5 GHz";
  if (iface.startsWith("RF_6GHZ")) return "6 GHz";
  if (iface.startsWith("RF_")) return iface.replace("RF_", "").replace("GHZ", " GHz");
  return iface || "—";
}

/** Radio-band code → readable name for the temperature readout. */
export function radioBandLabel(band: string): string {
  if (band === "RF_2GHZ") return "2.4 GHz";
  if (band === "RF_5GHZ") return "5 GHz";
  if (band === "RF_5GHZ_HIGH") return "5 GHz high";
  return band;
}

export interface SignalQuality {
  label: string;
  bars: number;
  colorVar: string;
}

/** Signal quality bucket from dBm (wifi). Ethernet has no RSSI. */
export function signalQuality(client: WifiClientJson): SignalQuality | null {
  if (client.iface === "ETH") return { label: "wired", bars: 4, colorVar: "--status-good" };
  const dbm = client.signalStrength;
  if (dbm === undefined || dbm === 0) return null;
  if (dbm > -55) return { label: "excellent", bars: 4, colorVar: "--status-good" };
  if (dbm > -67) return { label: "good", bars: 3, colorVar: "--status-good" };
  if (dbm > -75) return { label: "fair", bars: 2, colorVar: "--chart-warm" };
  return { label: "weak", bars: 1, colorVar: "--status-critical" };
}

/** Combined live rate for sorting. Reads the tracker's byte-delta rate where the
 *  hook has one; a device seen for the first time this poll has none yet, so it
 *  sorts on the router's average until its second reading lands. */
export function liveThroughputMbps(
  client: WifiClientJson,
  rates: Map<string, ThroughputRates>,
): number {
  const rate = client.macAddress
    ? rates.get(usageKey(client.clientId, client.macAddress))
    : undefined;
  if (rate) return rate.downMbps + rate.upMbps;
  return throughputMbps(client.rxStats) + throughputMbps(client.txStats);
}

/**
 * Identity of one roster entry, for row keys and selection. A bare MAC is not
 * enough: two devices can share a cloned MAC (two Govee lights, 2026-07-21) and
 * the router lists both — keyed by MAC alone, React sees duplicate keys, which
 * duplicates and omits rows unpredictably on every re-sort. clientId is the
 * router's own per-device id (its name store is keyed by it); for a normal
 * device without one this is just the MAC.
 */
export function clientEntryKey(client: WifiClientJson): string | null {
  if (!client.macAddress) return null;
  return client.clientId !== undefined
    ? `${client.macAddress}|${client.clientId}`
    : client.macAddress;
}

/** A device on the network rather than a router or mesh node. */
export function isClientDevice(client: WifiClientJson): boolean {
  return !client.role || client.role === "CLIENT";
}

export function displayName(client: WifiClientJson): string {
  return (
    client.givenName || client.name || client.ipAddress || client.macAddress || "Unnamed device"
  );
}

/** Subtitle line: hostname and/or derived vendor, de-duplicated. */
export function deviceSubtitle(client: WifiClientJson): string {
  const parts: string[] = [];
  if (client.name && client.name !== client.givenName) parts.push(client.name);
  const vendor = vendorForMac(client.macAddress);
  // "Private" is a meaningful subtitle, not a missing brand — a device behind a
  // randomized MAC. Show it like the official app does rather than hiding it.
  if (vendor && !parts.includes(vendor)) parts.push(vendor);
  return parts.join(" · ") || "unknown device";
}
