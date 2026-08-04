// Router Wi-Fi radio temperatures from the historian's /api/radio. These are
// the only real temperatures anything on the network reports — the dish gives
// thermal state as bare booleans and no number. Polled only while a panel that
// shows them is open, as useRouterNetwork does for the client list.
//
// The reading and its duty cycle travel together on purpose: temperature
// climbing while duty cycle falls below 100 is the router throttling a radio to
// cool it. One without the other is half the story.

import { useEffect, useState } from "react";
import { apiRequest } from "../lib/apiHost";

export interface RadioReading {
  /** "RF_2GHZ" | "RF_5GHZ" | "RF_5GHZ_HIGH". */
  band: string;
  /** On-chip sensor. The router states no unit; treat the number as unitless. */
  tempC: number;
  /** Percent of airtime the radio may transmit; the router cuts it to cool down. */
  dutyCycle: number;
}

export interface RadioTemps {
  current: RadioReading[];
  atMs: number | null;
  unavailable: boolean;
}

const REFRESH_MS = 15_000;

export function useRadioTemps(): RadioTemps {
  const [data, setData] = useState<Omit<RadioTemps, "unavailable">>({
    current: [],
    atMs: null,
  });
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await apiRequest("/api/radio", {
          signal: AbortSignal.timeout(4_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as Omit<RadioTemps, "unavailable">;
        if (cancelled) return;
        setData({
          current: payload.current ?? [],
          atMs: payload.atMs ?? null,
        });
        setUnavailable(false);
      } catch {
        if (!cancelled) setUnavailable(true);
      }
    };

    void load();
    const timerId = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, []);

  return { ...data, unavailable };
}
