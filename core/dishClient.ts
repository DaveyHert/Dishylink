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

// Same Device service on both boxes; the schema protoset is identical. The
// defaults are the dev/Electron same-origin proxy paths; a host that reaches the
// boxes directly (the extension, whose host permissions allow it) rebinds them.
const DISH_HANDLE_URL = "/dishy/SpaceX.API.Device.Device/Handle";
const ROUTER_HANDLE_URL = "/router/SpaceX.API.Device.Device/Handle";

interface DishHost {
  dishHandleUrl?: string;
  routerHandleUrl?: string;
  protosetUrl?: string;
}

let dishHost: DishHost = {};

/** Called once by a host entry point, before the UI renders. Leaving a box's URL
 *  unset keeps its default proxy path — for the extension that path 404s against
 *  its own origin, so an unconfigured box is simply never reached. */
export function setDishHost(binding: DishHost): void {
  dishHost = binding;
}

/** The router's LAN address — the only one it answers on, which is what makes it
 *  collidable with another router's default. lib/routerDiagnosis turns a failure
 *  to reach it into the one wording every surface reports. */
export const ROUTER_LAN_ADDRESS = "192.168.1.1";
export const ROUTER_LAN_HANDLE_URL = `http://${ROUTER_LAN_ADDRESS}:9001/SpaceX.API.Device.Device/Handle`;

/** The dish's LAN address. A relative handle URL resolves against a browser's
 *  own origin through its dev/Electron proxy; code that runs outside a browser
 *  (the dev server's own process, preparing a cloud write) has no such origin
 *  and needs this absolute one instead. */
export const DISH_LAN_ADDRESS = "192.168.100.1";
export const DISH_LAN_HANDLE_URL = `http://${DISH_LAN_ADDRESS}:9201/SpaceX.API.Device.Device/Handle`;

// Oneof field numbers inside SpaceX.API.Device.Request (from the dish schema).
const REQUEST_FIELD = {
  reboot: 1001,
  factoryReset: 1011,
  getStatus: 1004,
  getHistory: 1007,
  getDeviceInfo: 1008,
  getLocation: 1017,
  dishStow: 2002,
  dishGetObstructionMap: 2008,
  wifiGetClients: 3002,
  getRadioStats: 1036,
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
  /** What the motors are doing ("ACTUATOR_STATE_TILT", …). Absent means the zero
   *  value, ACTUATOR_STATE_IDLE — which is why a dish that sends nothing here
   *  still reads "Idle" in the official app. */
  actuatorState?: string;
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
  /** Routers the dish is currently talking to, keyed by the same DeviceId the
   *  cloud telemetry uses ("Router-<hex>"), with the dish's own view of when it
   *  last heard from each. The account panel reads this so a mesh node — which
   *  has no LAN address of its own to poll — still gets a live dot rather than
   *  waiting on the cloud's ~2-minute upload cycle. A node that is down is
   *  dropped from the map entirely (verified 2026-07-29: a mesh unit dark for
   *  2.7 days was absent while the controller was listed). */
  downstreamRouters?: Record<string, { role?: string; lastSeen?: string }>;
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
  /** How the kit is licensed to move: "STATIONARY", "NOMADIC" or "MOBILE".
   *  Absent means STATIONARY — proto3 drops the zero value — which is why a
   *  fixed install never sends it. A MOBILE kit is allowed to aim all the way to
   *  zenith, so the alignment band ceiling depends on this. */
  mobilityClass?: string;
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

/** How the obstruction grid is oriented. FRAME_EARTH is north-up; FRAME_UT
 *  is dish-relative (bottom-center is the boresight azimuth). Mini kits on
 *  roam typically report FRAME_UT; a Standard on a fixed site reports FRAME_EARTH. */
export type ObstructionMapReferenceFrame = "FRAME_UNKNOWN" | "FRAME_EARTH" | "FRAME_UT";

export interface DishObstructionMapJson {
  numRows?: number;
  numCols?: number;
  snr?: number[];
  maxThetaDeg?: number;
  mapReferenceFrame?: ObstructionMapReferenceFrame;
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

/** config field → its apply_* flag (both sides proto3 JSON names). Exported so
 *  a cloud-authenticated write can build the identical payload — current
 *  firmware refuses this config write over the LAN. */
export const CONFIG_APPLY_FLAG: Record<keyof DishConfigJson, string> = {
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
  /** The DNS servers the router forwards to. Absent means Starlink's own — proto3
   *  omits an empty repeated field, so absent and empty are the same answer. */
  nameservers?: string[];
  /** True when this kit is not permitted to set custom DNS at all. */
  customDnsDisabled?: boolean;
  networks?: WifiLanNetworkJson[];
  meshConfigs?: Record<string, WifiMeshNodeJson>;
  clientConfigs?: WifiClientConfigJson[];
  boot?: { evenSideSoftwareVersion?: string; oddSideSoftwareVersion?: string; lastReason?: string };
  [key: string]: unknown;
}

export interface WifiBlockRangeJson {
  startMinutes?: number;
  endMinutes?: number;
}

export interface WifiWeeklyBlockScheduleJson {
  blockRanges?: WifiBlockRangeJson[];
  groupId?: string;
}

export interface WifiClientConfigJson {
  clientId?: number;
  macAddress?: string;
  givenName?: string;
  weeklyBlockSchedules?: WifiWeeklyBlockScheduleJson[];
  groupId?: string;
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
 * Point-in-time rate for one direction, the fallback when the exact byte-delta
 * rate is unavailable. The 15s average is preferred over the 1-minute one: the
 * shorter window sits closer to the current rate, and txStats carries no 1m field
 * at all — preferring 1m would smooth download over 60s while upload rode a 15s
 * window on the same chart. The 1m average is only a further fallback, and the
 * "NaN" string the router emits on quiet clients is rejected either way.
 */
export function throughputMbps(stats: WifiClientStatsJson | undefined): number {
  return (
    finiteMbps(stats?.throughputMbpsLast15sAvg) ?? finiteMbps(stats?.throughputMbpsLast1mAvg) ?? 0
  );
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
  /** Router's estimate of the link back to the controller, per direction. On a
   *  mesh node this is the backhaul everything it relays has to fit through —
   *  measured at ~320/1000 Mbps on 5 GHz and ~216/187 after it fell to 2.4 GHz.
   *  Absent on the controller itself, which has no upstream radio link. */
  estRxRateMbpsFromController?: number;
  estTxRateMbpsFromController?: number;
  associatedTimeS?: number;
  secondsUntilDhcpLeaseExpires?: number;
  dhcpLeaseActive?: boolean;
  /** Router's internal id for this client — the number the app prints under the
   *  device name. Reissued whenever the MAC changes, which on a phone or laptop
   *  using a private Wi-Fi address includes an ordinary rotation. */
  clientId?: number;
  /** Per-client 32-byte hex the router derives from something it does not expose:
   *  devices behind one vendor-masked MAC each get a distinct value, so it is not
   *  a hash of the address we are given. Whether it survives a MAC rotation is
   *  unproven — recorded so a rotation answers it, and safe to trust on a match
   *  either way, since a match can at worst mean the same full MAC. */
  captiveClientId?: string;
  /** Seconds since the client last passed traffic. Omitted (proto3 drops zeros)
   *  while data is flowing, so `undefined` means "active right now". */
  noDataIdleS?: number;
  /** True while the device is paused (its internet blocked). A manual pause is a
   *  whole-week `_permanent` block schedule in its clientConfig; the router
   *  surfaces the live effect here. Set from the app (LAN writes are denied), but
   *  readable locally — see wifiConfig.clientConfigs[].weeklyBlockSchedules. */
  blocked?: boolean;
  /** Cumulative per-client totals, in megabytes despite the name.
   *
   *  Not interchangeable with rxStats.bytes / txStats.bytes: these appear to
   *  count WAN-attributed traffic only, where the byte counters count everything
   *  crossing the radio. They diverge by large factors in either direction, so
   *  a device's totals are read from the byte counters. On a client whose
   *  traffic is nearly all WAN — a downstream router — the two agree, which
   *  makes the difference easy to miss.
   *
   *  A wired client has empty rxStats/txStats and only these, which is why its
   *  usage reads blank rather than a different quantity under the same label.
   *
   *  Guard anything built on them: a client has been seen reporting ~3.7e9. */
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
  getRadioStats?: RadioStatsJson;
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
  /** Share of the router's own pings to the PoP lost over a rolling five
   *  minutes, 0–1, computed by the router. The safe source for router ping
   *  success: it rides the get_status reply already polled everywhere, unlike
   *  get_ping (1009), which rebooted the router every time it was polled
   *  (2026-07-20, three trials at three cadences). Absent means the proto3
   *  zero — no drops — not "unsupported": this firmware sends the field.
   *  NOTE the lowercase trailing `m`: the LAN reply spells it `5m`, unlike the
   *  app's cloud debug dump (`5M`) — verified by probe on this firmware. */
  popPingDropRate5m?: number;
  ipv4WanAddress?: string;
}

/** The router's per-radio Wi-Fi stats — the only real temperatures on this LAN.
 *  Only `temp2` is populated on current firmware; `temp` is absent. */
export interface RadioStatsJson {
  radioStats?: Array<{
    band?: string;
    thermalStatus?: { temp?: number; temp2?: number; dutyCycle?: number };
  }>;
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

  /**
   * Load the descriptor set dumped from the dish's reflection service.
   *
   * The default handle URLs are the dev/Electron proxy paths; a host that reaches
   * the dish directly overrides them. The extension does: its service worker has
   * no proxy, so it passes the absolute `192.168.100.1:9201` grpc-web endpoint,
   * which its host permissions allow it to fetch cross-origin.
   */
  static async load(
    target: "dish" | "router" = "dish",
    options: { handleUrl?: string; protosetUrl?: string; protosetBytes?: Uint8Array } = {},
  ): Promise<DishClient> {
    const protosetBytes = options.protosetBytes
      ? options.protosetBytes
      : new Uint8Array(
          await (
            await fetch(options.protosetUrl ?? dishHost.protosetUrl ?? "/dish.protoset")
          ).arrayBuffer(),
        );
    const fileDescriptorSet = fromBinary(FileDescriptorSetSchema, protosetBytes);
    const registry = createFileRegistry(fileDescriptorSet);
    const requestSchema = registry.getMessage("SpaceX.API.Device.Request");
    const responseSchema = registry.getMessage("SpaceX.API.Device.Response");
    if (!requestSchema || !responseSchema)
      throw new Error("Device Request/Response missing from dish.protoset");
    const hostDefault = target === "dish" ? dishHost.dishHandleUrl : dishHost.routerHandleUrl;
    const handleUrl =
      options.handleUrl ?? hostDefault ?? (target === "dish" ? DISH_HANDLE_URL : ROUTER_HANDLE_URL);
    return new DishClient(handleUrl, requestSchema, responseSchema, registry);
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
    return toJson(this.responseSchema, responseMessage, {
      registry: this.registry,
    }) as DishResponseJson;
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
    return (
      (await this.call(REQUEST_FIELD.getDeviceInfo, abortSignal)).getDeviceInfo?.deviceInfo ?? {}
    );
  }

  async getObstructionMap(abortSignal?: AbortSignal): Promise<DishObstructionMapJson> {
    return (
      (await this.call(REQUEST_FIELD.dishGetObstructionMap, abortSignal)).dishGetObstructionMap ??
      {}
    );
  }

  /**
   * Dish GPS position. Throws GrpcWebError status 7 on consumer plans —
   * "Disabled due to policy" since the May 2026 firmware; the app's old
   * "Allow access on local network" toggle no longer exists.
   */
  async getLocation(abortSignal?: AbortSignal): Promise<DishLocationJson> {
    return (await this.call(REQUEST_FIELD.getLocation, abortSignal)).getLocation ?? {};
  }

  /** Connected clients — meaningful on the ROUTER target. */
  async getWifiClients(abortSignal?: AbortSignal): Promise<WifiClientJson[]> {
    return (
      (await this.call(REQUEST_FIELD.wifiGetClients, abortSignal)).wifiGetClients?.clients ?? []
    );
  }

  /** Per-radio Wi-Fi stats — meaningful on the ROUTER target. The only real
   *  temperatures anything on this network reports; the dish answers Unimplemented. */
  async getRadioStats(abortSignal?: AbortSignal): Promise<RadioStatsJson> {
    return (await this.call(REQUEST_FIELD.getRadioStats, abortSignal)).getRadioStats ?? {};
  }

  /** Reboot this device (dish or router). Drops connectivity for a few minutes. */
  async reboot(abortSignal?: AbortSignal): Promise<void> {
    await this.call(REQUEST_FIELD.reboot, abortSignal);
  }

  /** Wipe the device back to its shipped state. On a router that includes the
   *  WiFi name and passphrase, and bypass mode with them: it is the only exit
   *  the official app leaves once bypass is on. FactoryResetRequest is empty. */
  async factoryReset(abortSignal?: AbortSignal): Promise<void> {
    await this.call(REQUEST_FIELD.factoryReset, abortSignal);
  }

  /** Stow (fold flat) or unstow the dish. Motorized (mast) models only. */
  async stow(unstow: boolean, abortSignal?: AbortSignal): Promise<void> {
    // DishStowRequest { bool unstow = 1 } — field 1, varint wire type
    await this.call(REQUEST_FIELD.dishStow, abortSignal, unstow ? [0x08, 0x01] : []);
  }

  // ---------- schema-encoded requests (config writes and richer payloads) ----------

  /** Encode a full Request from proto3 JSON via the bundled schema. */
  /** Encode a Device.Request for an authenticated host to send through the cloud
   *  gateway. This does not perform a local router write. */
  encodeRequest(requestJson: object): Uint8Array {
    return toBinary(
      this.requestSchema,
      fromJson(this.requestSchema, requestJson as JsonValue, { registry: this.registry }),
    );
  }

  /** Decode a Device.Response the host fetched through the cloud gateway. Pairs
   *  with `encodeRequest` for the reads that have no LAN path. */
  decodeResponse(responseBytes: Uint8Array): DishResponseJson {
    return toJson(this.responseSchema, fromBinary(this.responseSchema, responseBytes), {
      registry: this.registry,
    }) as DishResponseJson;
  }

  /** Current dish configuration (sleep schedule, snow melt, update window …). */
  async getConfig(abortSignal?: AbortSignal): Promise<DishConfigJson & Record<string, unknown>> {
    return (
      (await this.call(REQUEST_FIELD.dishGetConfig, abortSignal)).dishGetConfig?.dishConfig ?? {}
    );
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
    return (
      (await this.call(REQUEST_FIELD.wifiGetConfig, abortSignal)).wifiGetConfig?.wifiConfig ?? {}
    );
  }
}
