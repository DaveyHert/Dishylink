// Client for the Starlink dish's local gRPC API (SpaceX.API.Device.Device/Handle),
// spoken as grpc-web through the dev-server proxy at /dishy.
//
// Requests are trivial — a single empty sub-message selected by oneof field
// number — so they are hand-encoded. Responses are decoded dynamically with
// the descriptor set dumped from the dish's own gRPC reflection service
// (public/dish.protoset), so field numbers and types are never guessed.

import { createFileRegistry, fromBinary, toJson, type DescMessage, type Registry } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { grpcWebUnaryCall } from "./grpcWeb";

const HANDLE_METHOD_URL = "/dishy/SpaceX.API.Device.Device/Handle";

// Oneof field numbers inside SpaceX.API.Device.Request (from the dish schema).
const REQUEST_FIELD = {
  getStatus: 1004,
  getHistory: 1007,
  getDeviceInfo: 1008,
  getLocation: 1017,
  dishGetObstructionMap: 2008,
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
}

export interface DishGpsStatsJson {
  gpsValid?: boolean;
  gpsSats?: number;
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
  gpsStats?: DishGpsStatsJson;
  ethSpeedMbps?: number;
  classOfService?: string;
  softwareUpdateState?: string;
  alignmentStats?: DishAlignmentStatsJson;
  connectedRouters?: string[];
  dlBandwidthRestrictedReason?: string;
  ulBandwidthRestrictedReason?: string;
  isSnrAboveNoiseFloor?: boolean;
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

interface DishResponseJson {
  dishGetStatus?: DishStatusJson;
  dishGetHistory?: DishHistoryJson;
  getDeviceInfo?: { deviceInfo?: DishDeviceInfoJson };
  getLocation?: DishLocationJson;
  dishGetObstructionMap?: DishObstructionMapJson;
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

/** Encode a Request whose oneof selects `fieldNumber` with an empty sub-message. */
function encodeEmptyOneofRequest(fieldNumber: number): Uint8Array {
  const LENGTH_DELIMITED_WIRE_TYPE = 2;
  const fieldTag = (fieldNumber << 3) | LENGTH_DELIMITED_WIRE_TYPE;
  return new Uint8Array([...encodeVarint(fieldTag), 0]);
}

// ---------- client ----------

export class DishClient {
  private constructor(
    private readonly responseSchema: DescMessage,
    private readonly registry: Registry,
  ) {}

  /** Load the descriptor set dumped from the dish's reflection service. */
  static async load(): Promise<DishClient> {
    const protosetResponse = await fetch("/dish.protoset");
    const protosetBytes = new Uint8Array(await protosetResponse.arrayBuffer());
    const fileDescriptorSet = fromBinary(FileDescriptorSetSchema, protosetBytes);
    const registry = createFileRegistry(fileDescriptorSet);
    const responseSchema = registry.getMessage("SpaceX.API.Device.Response");
    if (!responseSchema) throw new Error("SpaceX.API.Device.Response missing from dish.protoset");
    return new DishClient(responseSchema, registry);
  }

  private async call(fieldNumber: number, abortSignal?: AbortSignal): Promise<DishResponseJson> {
    const responseBytes = await grpcWebUnaryCall(
      HANDLE_METHOD_URL,
      encodeEmptyOneofRequest(fieldNumber),
      abortSignal,
    );
    const responseMessage = fromBinary(this.responseSchema, responseBytes);
    return toJson(this.responseSchema, responseMessage, { registry: this.registry }) as DishResponseJson;
  }

  async getStatus(abortSignal?: AbortSignal): Promise<DishStatusJson> {
    return (await this.call(REQUEST_FIELD.getStatus, abortSignal)).dishGetStatus ?? {};
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
}
