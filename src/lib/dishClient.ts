// Client for the Starlink dish's local gRPC API (SpaceX.API.Device.Device/Handle),
// spoken as grpc-web through the dev-server proxy at /dishy.
//
// Requests are trivial — a single empty sub-message selected by oneof field
// number — so they are hand-encoded. Responses are decoded dynamically with
// the descriptor set dumped from the dish's own gRPC reflection service
// (public/dish.protoset), so field numbers and types are never guessed.

import {
  createFileRegistry,
  fromBinary,
  fromJson,
  toBinary,
  toJson,
  type DescMessage,
  type JsonValue,
  type Registry,
} from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { grpcWebUnaryCall } from "./grpcWeb";

// Same Device service on both boxes; the schema protoset is identical.
const DISH_HANDLE_URL = "/dishy/SpaceX.API.Device.Device/Handle";
const ROUTER_HANDLE_URL = "/router/SpaceX.API.Device.Device/Handle";

// Oneof field numbers inside SpaceX.API.Device.Request (from the dish schema).
const REQUEST_FIELD = {
  reboot: 1001,
  getStatus: 1004,
  getHistory: 1007,
  getDeviceInfo: 1008,
  getLocation: 1017,
  dishStow: 2002,
  dishGetObstructionMap: 2008,
  wifiGetClients: 3002,
  getDiagnostics: 6000,
  dishGetConfig: 2011,
  wifiGetConfig: 3009,
  dishClearObstructionMap: 2017,
} as const;

// ---------- response JSON shapes (proto3 JSON mapping; uint64 → string) ----------

export interface DishDeviceInfoJson {
  id?: string;
  hardwareVersion?: string;
  softwareVersion?: string;
  countryCode?: string;
  bootcount?: number;
}

export interface DishObstructionStatsJson {
  fractionObstructed?: number;
  validS?: number;
  avgProlongedObstructionIntervalS?: number | "NaN" | "Infinity";
  patchesValid?: number;
}

export interface DishAlignmentStatsJson {
  tiltAngleDeg?: number;
  boresightAzimuthDeg?: number;
  boresightElevationDeg?: number;
  desiredBoresightAzimuthDeg?: number;
  desiredBoresightElevationDeg?: number;
  attitudeEstimationState?: string;
  attitudeUncertaintyDeg?: number;
  /** "HAS_ACTUATORS_NO" on electronically-steered kits, "HAS_ACTUATORS_YES" on motorized. */
  hasActuators?: string;
}

export interface DishGpsStatsJson {
  gpsValid?: boolean;
  gpsSats?: number;
  /** Position/navigation filter state, e.g. "FILTER_CONVERGED". */
  pntFilterConvergenceState?: string;
}

/** The dish's orientation as a unit quaternion (NED → dish frame). */
export interface DishQuaternionJson {
  qScalar?: number;
  qX?: number;
  qY?: number;
  qZ?: number;
}

/** Per-subsystem readiness flags; all true = fully online. */
export interface DishReadyStatesJson {
  scp?: boolean;
  l1l2?: boolean;
  xphy?: boolean;
  aap?: boolean;
  rf?: boolean;
}

export interface DishStatusJson {
  deviceInfo?: DishDeviceInfoJson;
  deviceState?: { uptimeS?: string };
  obstructionStats?: DishObstructionStatsJson;
  alerts?: Record<string, boolean>;
  downlinkThroughputBps?: number;
  uplinkThroughputBps?: number;
  popPingLatencyMs?: number;
  popPingDropRate?: number;
  boresightAzimuthDeg?: number;
  boresightElevationDeg?: number;
  stowRequested?: boolean;
  gpsStats?: DishGpsStatsJson;
  ethSpeedMbps?: number;
  classOfService?: string;
  softwareUpdateState?: string;
  alignmentStats?: DishAlignmentStatsJson;
  connectedRouters?: string[];
  dlBandwidthRestrictedReason?: string;
  ulBandwidthRestrictedReason?: string;
  isSnrAboveNoiseFloor?: boolean;
  /** Set when SNR has stayed low long enough to look like weather, not a blip —
   *  the flag behind the dish's own RAIN_SNR_PERSISTENTLY_LOW alert. Absent
   *  (proto3 drops false) means the signal is holding. */
  isSnrPersistentlyLow?: boolean;
  /** Per-subsystem online flags — which stage is up while the dish boots. */
  readyStates?: DishReadyStatesJson;
  /** Seconds until a pending software-update reboot is possible; −1 = none pending. */
  secondsUntilSwupdateRebootPossible?: number;
  /** NAT state, e.g. "NAT_DISABLED" in bypass mode. */
  natFlag?: string;
  /** Dish attitude as a quaternion — more precise than the two boresight angles. */
  ned2dishQuaternion?: DishQuaternionJson;
  /** Motorized ("HAS_ACTUATORS_YES") vs electronically-steered ("HAS_ACTUATORS_NO"). */
  hasActuators?: string;
}

export interface DishOutageJson {
  cause?: string;
  startTimestampNs?: string;
  durationNs?: string;
  didSwitch?: boolean;
}

export interface DishEventJson {
  severity?: string;
  reason?: string;
  startTimestampNs?: string;
  durationNs?: string;
}

export interface DishHistoryJson {
  current?: string | number;
  popPingDropRate?: number[];
  popPingLatencyMs?: number[];
  downlinkThroughputBps?: number[];
  uplinkThroughputBps?: number[];
  powerIn?: number[];
  outages?: DishOutageJson[];
  eventLog?: { events?: DishEventJson[] };
}

export interface DishLocationJson {
  lla?: { lat?: number; lon?: number; alt?: number };
  source?: string;
}

export interface DishObstructionMapJson {
  numRows?: number;
  numCols?: number;
  snr?: number[];
  maxThetaDeg?: number;
}

// ---------- config / diagnostics shapes ----------

export type SnowMeltMode = "AUTO" | "ALWAYS_ON" | "ALWAYS_OFF";

/** Writable dish knobs (proto3 JSON field names). Every set is partial: only
    the fields present are applied, via their matching apply_* flags. */
export interface DishConfigJson {
  snowMeltMode?: SnowMeltMode;
  locationRequestMode?: "NONE" | "LOCAL";
  levelDishMode?: "TILT_LIKE_NORMAL" | "FORCE_LEVEL";
  powerSaveStartMinutes?: number;
  powerSaveDurationMinutes?: number;
  powerSaveMode?: boolean;
  swupdateRebootHour?: number;
  swupdateThreeDayDeferralEnabled?: boolean;
}

/** config field → its apply_* flag (both sides proto3 JSON names) */
const CONFIG_APPLY_FLAG: Record<keyof DishConfigJson, string> = {
  snowMeltMode: "applySnowMeltMode",
  locationRequestMode: "applyLocationRequestMode",
  levelDishMode: "applyLevelDishMode",
  powerSaveStartMinutes: "applyPowerSaveStartMinutes",
  powerSaveDurationMinutes: "applyPowerSaveDurationMinutes",
  powerSaveMode: "applyPowerSaveMode",
  swupdateRebootHour: "applySwupdateRebootHour",
  swupdateThreeDayDeferralEnabled: "applySwupdateThreeDayDeferralEnabled",
};

export interface DishDiagnosticsJson {
  id?: string;
  hardwareVersion?: string;
  softwareVersion?: string;
  alerts?: Record<string, unknown>;
  disablementCode?: string;
  hardwareSelfTest?: string;
  alignmentStats?: DishAlignmentStatsJson;
}

export interface WifiBasicServiceSetJson {
  bssid?: string;
  ssid?: string;
  band?: string;
  ifaceName?: string;
}

export interface WifiLanNetworkJson {
  ipv4?: string;
  domain?: string;
  basicServiceSets?: WifiBasicServiceSetJson[];
}

/** A mesh node the router has been paired with, keyed in `meshConfigs` by the
 *  node's `deviceId` (same "Router-<hex>" namespace the client list reports).
 *  Entries persist across disconnects, so this is the roster of *known* nodes —
 *  whether one is currently up is decided by the live client list. */
export interface WifiMeshNodeJson {
  displayName?: string;
  auth?: string;
  hardwareVersion?: string;
  lastConnected?: string;
}

export interface WifiNetworkConfigJson {
  countryCode?: string;
  networks?: WifiLanNetworkJson[];
  meshConfigs?: Record<string, WifiMeshNodeJson>;
  clientConfigs?: Array<{ clientId?: number; macAddress?: string; givenName?: string }>;
  boot?: { evenSideSoftwareVersion?: string; oddSideSoftwareVersion?: string; lastReason?: string };
  [key: string]: unknown;
}

export interface WifiClientStatsJson {
  bytes?: string;
  rateMbps?: number;
  bandwidth?: number;
  nss?: number;
  mcs?: number;
  /** proto3 JSON encodes a NaN double as the *string* "NaN" — the router does
   *  this on quiet clients — so these are never safely arithmetic. Read them
   *  through throughputMbps(). */
  throughputMbpsLast1mAvg?: number | "NaN";
  throughputMbpsLast15sAvg?: number | "NaN";
}

/** A reading only if it is really a number: rejects undefined and the "NaN" string. */
function finiteMbps(value: number | "NaN" | undefined): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Point-in-time rate for one direction. The router omits the 1-minute average on
 * clients that have not been associated for a minute, so fall back to the 15s
 * one rather than reporting a device with live traffic as idle — and take the
 * first value that is actually a number, since either may arrive as "NaN".
 */
export function throughputMbps(stats: WifiClientStatsJson | undefined): number {
  return finiteMbps(stats?.throughputMbpsLast1mAvg) ?? finiteMbps(stats?.throughputMbpsLast15sAvg) ?? 0;
}

export interface WifiClientJson {
  name?: string;
  givenName?: string;
  macAddress?: string;
  ipAddress?: string;
  ipv6Addresses?: string[];
  signalStrength?: number;
  snr?: number;
  iface?: string;
  ifaceName?: string;
  channelWidth?: number;
  role?: string;
  deviceId?: string;
  upstreamMacAddress?: string;
  hopsFromController?: number;
  associatedTimeS?: number;
  secondsUntilDhcpLeaseExpires?: number;
  dhcpLeaseActive?: boolean;
  /** Router's internal id for this client — the number the app prints under the
   *  device name. */
  clientId?: number;
  /** Seconds since the client last passed traffic. Omitted (proto3 drops zeros)
   *  while data is flowing, so `undefined` means "active right now". */
  noDataIdleS?: number;
  /** Do NOT render these: the router reports nonsense here (uploadMb reads
   *  ~3.7e9 "Mb" against 15 MB of rxStats.bytes). Real per-device totals live in
   *  rxStats.bytes / txStats.bytes. */
  uploadMb?: number;
  downloadMb?: number;
  rxStats?: WifiClientStatsJson;
  txStats?: WifiClientStatsJson;
}

interface DishResponseJson {
  dishGetStatus?: DishStatusJson;
  dishGetHistory?: DishHistoryJson;
  getDeviceInfo?: { deviceInfo?: DishDeviceInfoJson };
  getLocation?: DishLocationJson;
  dishGetObstructionMap?: DishObstructionMapJson;
  wifiGetClients?: { clients?: WifiClientJson[] };
  dishGetConfig?: { dishConfig?: DishConfigJson & Record<string, unknown> };
  dishGetDiagnostics?: DishDiagnosticsJson;
  wifiGetConfig?: { wifiConfig?: WifiNetworkConfigJson };
  wifiGetStatus?: WifiStatusJson;
}

/** The router's own get_status. Its alerts are a different set from the dish's. */
export interface WifiStatusJson {
  deviceInfo?: DishDeviceInfoJson;
  deviceState?: { uptimeS?: string };
  alerts?: Record<string, boolean>;
  pingLatencyMs?: number;
  dishPingLatencyMs?: number;
  popPingLatencyMs?: number;
  ipv4WanAddress?: string;
}

// ---------- request encoding ----------

function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value;
  while (remaining > 0x7f) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  bytes.push(remaining);
  return bytes;
}

/** Encode a Request whose oneof selects `fieldNumber` with the given sub-message bytes. */
function encodeOneofRequest(fieldNumber: number, subMessageBytes: number[] = []): Uint8Array {
  const LENGTH_DELIMITED_WIRE_TYPE = 2;
  const fieldTag = (fieldNumber << 3) | LENGTH_DELIMITED_WIRE_TYPE;
  return new Uint8Array([...encodeVarint(fieldTag), subMessageBytes.length, ...subMessageBytes]);
}

// ---------- client ----------

export class DishClient {
  private constructor(
    private readonly handleUrl: string,
    private readonly requestSchema: DescMessage,
    private readonly responseSchema: DescMessage,
    private readonly registry: Registry,
  ) {}

  /** Load the descriptor set dumped from the dish's reflection service. */
  static async load(target: "dish" | "router" = "dish"): Promise<DishClient> {
    const protosetResponse = await fetch("/dish.protoset");
    const protosetBytes = new Uint8Array(await protosetResponse.arrayBuffer());
    const fileDescriptorSet = fromBinary(FileDescriptorSetSchema, protosetBytes);
    const registry = createFileRegistry(fileDescriptorSet);
    const requestSchema = registry.getMessage("SpaceX.API.Device.Request");
    const responseSchema = registry.getMessage("SpaceX.API.Device.Response");
    if (!requestSchema || !responseSchema) throw new Error("Device Request/Response missing from dish.protoset");
    return new DishClient(
      target === "dish" ? DISH_HANDLE_URL : ROUTER_HANDLE_URL,
      requestSchema,
      responseSchema,
      registry,
    );
  }

  private async call(
    fieldNumber: number,
    abortSignal?: AbortSignal,
    subMessageBytes: number[] = [],
  ): Promise<DishResponseJson> {
    const responseBytes = await grpcWebUnaryCall(
      this.handleUrl,
      encodeOneofRequest(fieldNumber, subMessageBytes),
      abortSignal,
    );
    const responseMessage = fromBinary(this.responseSchema, responseBytes);
    return toJson(this.responseSchema, responseMessage, { registry: this.registry }) as DishResponseJson;
  }

  async getStatus(abortSignal?: AbortSignal): Promise<DishStatusJson> {
    return (await this.call(REQUEST_FIELD.getStatus, abortSignal)).dishGetStatus ?? {};
  }

  /** The ROUTER's own status — same request field, different device, different
   *  response branch. Carries the router's alert set (PoE faults, mesh health). */
  async getRouterStatus(abortSignal?: AbortSignal): Promise<WifiStatusJson> {
    return (await this.call(REQUEST_FIELD.getStatus, abortSignal)).wifiGetStatus ?? {};
  }

  async getHistory(abortSignal?: AbortSignal): Promise<DishHistoryJson> {
    return (await this.call(REQUEST_FIELD.getHistory, abortSignal)).dishGetHistory ?? {};
  }

  async getDeviceInfo(abortSignal?: AbortSignal): Promise<DishDeviceInfoJson> {
    return (await this.call(REQUEST_FIELD.getDeviceInfo, abortSignal)).getDeviceInfo?.deviceInfo ?? {};
  }

  async getObstructionMap(abortSignal?: AbortSignal): Promise<DishObstructionMapJson> {
    return (await this.call(REQUEST_FIELD.dishGetObstructionMap, abortSignal)).dishGetObstructionMap ?? {};
  }

  /**
   * Dish GPS position. Throws GrpcWebError status 7 (PermissionDenied) until
   * the user enables "Allow access on local network" in the Starlink app.
   */
  async getLocation(abortSignal?: AbortSignal): Promise<DishLocationJson> {
    return (await this.call(REQUEST_FIELD.getLocation, abortSignal)).getLocation ?? {};
  }

  /** Connected clients — meaningful on the ROUTER target. */
  async getWifiClients(abortSignal?: AbortSignal): Promise<WifiClientJson[]> {
    return (await this.call(REQUEST_FIELD.wifiGetClients, abortSignal)).wifiGetClients?.clients ?? [];
  }

  /** Reboot this device (dish or router). Drops connectivity for a few minutes. */
  async reboot(abortSignal?: AbortSignal): Promise<void> {
    await this.call(REQUEST_FIELD.reboot, abortSignal);
  }

  /** Stow (fold flat) or unstow the dish. Motorized (mast) models only. */
  async stow(unstow: boolean, abortSignal?: AbortSignal): Promise<void> {
    // DishStowRequest { bool unstow = 1 } — field 1, varint wire type
    await this.call(REQUEST_FIELD.dishStow, abortSignal, unstow ? [0x08, 0x01] : []);
  }

  // ---------- schema-encoded requests (config writes and richer payloads) ----------

  /** Encode a full Request from proto3 JSON via the bundled schema. */
  private async callJson(requestJson: Record<string, unknown>, abortSignal?: AbortSignal): Promise<DishResponseJson> {
    const requestMessage = fromJson(this.requestSchema, requestJson as JsonValue, { registry: this.registry });
    const responseBytes = await grpcWebUnaryCall(
      this.handleUrl,
      toBinary(this.requestSchema, requestMessage),
      abortSignal,
    );
    const responseMessage = fromBinary(this.responseSchema, responseBytes);
    return toJson(this.responseSchema, responseMessage, { registry: this.registry }) as DishResponseJson;
  }

  /** Current dish configuration (sleep schedule, snow melt, update window …). */
  async getConfig(abortSignal?: AbortSignal): Promise<DishConfigJson & Record<string, unknown>> {
    return (await this.call(REQUEST_FIELD.dishGetConfig, abortSignal)).dishGetConfig?.dishConfig ?? {};
  }

  /**
   * Apply a partial config change. Only the fields present are written — the
   * matching apply_* flags are set automatically so untouched knobs stay put.
   */
  async setConfig(changes: DishConfigJson, abortSignal?: AbortSignal): Promise<void> {
    const dishConfig: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(changes)) {
      if (value === undefined) continue;
      dishConfig[field] = value;
      dishConfig[CONFIG_APPLY_FLAG[field as keyof DishConfigJson]] = true;
    }
    await this.callJson({ dishSetConfig: { dishConfig } }, abortSignal);
  }

  /** Dish self-diagnostics: disablement code, hardware self-test, alerts. */
  async getDiagnostics(abortSignal?: AbortSignal): Promise<DishDiagnosticsJson> {
    return (await this.call(REQUEST_FIELD.getDiagnostics, abortSignal)).dishGetDiagnostics ?? {};
  }

  /** Wipe the learned sky map and restart the obstruction survey. */
  async clearObstructionMap(abortSignal?: AbortSignal): Promise<void> {
    await this.call(REQUEST_FIELD.dishClearObstructionMap, abortSignal);
  }

  /** Router WiFi configuration (SSID, channels, mesh) — ROUTER target. */
  async getWifiConfig(abortSignal?: AbortSignal): Promise<WifiNetworkConfigJson> {
    return (await this.call(REQUEST_FIELD.wifiGetConfig, abortSignal)).wifiGetConfig?.wifiConfig ?? {};
  }

  /** Rename a client device (persists in the router) — ROUTER target. */
  async setClientGivenName(macAddress: string, givenName: string, abortSignal?: AbortSignal): Promise<void> {
    await this.callJson({ wifiSetClientGivenName: { clientName: { macAddress, givenName } } }, abortSignal);
  }
}
