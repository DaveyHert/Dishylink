// Polling loop against the dish: status every 2s, history every 5s,
// obstruction map every 30s. All state a component needs comes out of here.

import { useEffect, useRef, useState } from "react";
import {
  DishClient,
  type DishStatusJson,
  type DishDeviceInfoJson,
  type DishObstructionMapJson,
  type DishLocationJson,
} from "../lib/dishClient";
import { GrpcWebError } from "../lib/grpcWeb";
import { TelemetryAccumulator, decodeOutageEvents, type TelemetrySample, type OutageEvent } from "../lib/telemetry";

const STATUS_POLL_MS = 2_000;
const HISTORY_POLL_MS = 5_000;
const OBSTRUCTION_POLL_MS = 30_000;
const LOCATION_RETRY_MS = 60_000; // picks up the app-side toggle without a reload
const MAX_ACCUMULATED_SAMPLES = 6 * 3_600; // keep up to six hours

export type DishConnectionState = "connecting" | "online" | "unreachable";

export interface DishTelemetry {
  connectionState: DishConnectionState;
  deviceInfo: DishDeviceInfoJson | null;
  status: DishStatusJson | null;
  samples: TelemetrySample[];
  outageEvents: OutageEvent[];
  obstructionMap: DishObstructionMapJson | null;
  /** Dish GPS position, once the Starlink app's local-access toggle allows it. */
  dishLocation: DishLocationJson | null;
  /** True while get_location returns PermissionDenied (toggle off in the app). */
  locationDenied: boolean;
}

export function useDishTelemetry(): DishTelemetry {
  const [connectionState, setConnectionState] = useState<DishConnectionState>("connecting");
  const [deviceInfo, setDeviceInfo] = useState<DishDeviceInfoJson | null>(null);
  const [status, setStatus] = useState<DishStatusJson | null>(null);
  const [samples, setSamples] = useState<TelemetrySample[]>([]);
  const [outageEvents, setOutageEvents] = useState<OutageEvent[]>([]);
  const [obstructionMap, setObstructionMap] = useState<DishObstructionMapJson | null>(null);
  const [dishLocation, setDishLocation] = useState<DishLocationJson | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const accumulatorRef = useRef(new TelemetryAccumulator(MAX_ACCUMULATED_SAMPLES));

  useEffect(() => {
    let disposed = false;
    let client: DishClient | null = null;
    const timerIds: number[] = [];

    const pollStatus = async () => {
      if (!client) return;
      try {
        const dishStatus = await client.getStatus();
        if (disposed) return;
        setStatus(dishStatus);
        setConnectionState("online");
      } catch {
        if (!disposed) setConnectionState("unreachable");
      }
    };

    const pollHistory = async () => {
      if (!client) return;
      try {
        const history = await client.getHistory();
        if (disposed) return;
        setSamples([...accumulatorRef.current.ingest(history, Date.now())]);
        setOutageEvents(decodeOutageEvents(history));
      } catch {
        // status polling owns the connection indicator
      }
    };

    const pollObstructionMap = async () => {
      if (!client) return;
      try {
        const skyMap = await client.getObstructionMap();
        if (!disposed) setObstructionMap(skyMap);
      } catch {
        // non-fatal; keep the last map
      }
    };

    let locationResolved = false;
    const pollLocation = async () => {
      if (!client || locationResolved) return;
      try {
        const location = await client.getLocation();
        if (disposed) return;
        if (location.lla?.lat !== undefined) {
          locationResolved = true;
          setDishLocation(location);
          setLocationDenied(false);
        }
      } catch (locationError) {
        if (!disposed && locationError instanceof GrpcWebError && locationError.grpcStatus === 7) {
          setLocationDenied(true);
        }
      }
    };

    (async () => {
      try {
        client = await DishClient.load();
        if (disposed) return;
        client.getDeviceInfo().then((info) => !disposed && setDeviceInfo(info)).catch(() => {});
        await Promise.all([pollStatus(), pollHistory(), pollObstructionMap(), pollLocation()]);
        timerIds.push(window.setInterval(pollStatus, STATUS_POLL_MS));
        timerIds.push(window.setInterval(pollHistory, HISTORY_POLL_MS));
        timerIds.push(window.setInterval(pollObstructionMap, OBSTRUCTION_POLL_MS));
        timerIds.push(window.setInterval(pollLocation, LOCATION_RETRY_MS));
      } catch {
        if (!disposed) setConnectionState("unreachable");
      }
    })();

    return () => {
      disposed = true;
      timerIds.forEach((timerId) => window.clearInterval(timerId));
    };
  }, []);

  return { connectionState, deviceInfo, status, samples, outageEvents, obstructionMap, dishLocation, locationDenied };
}
