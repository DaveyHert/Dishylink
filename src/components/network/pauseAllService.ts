// Service layer for bulk device pause operations.
//
// Pure functions only — no React, no i18n, no UI state. This keeps the
// logic unit-testable independently of the component tree and makes the
// component responsible only for display, not for the sequencing of writes.
//
// Design decisions:
// - Writes are serial, not concurrent. The cloud gateway serialises them on
//   its own side anyway, and serial sends give us accurate per-device progress.
// - Each device's outcome is recorded before moving to the next, so a network
//   drop mid-way leaves a correct partial record rather than an unknown state.
// - The function never throws: every error is captured per-device so callers
//   can display partial results and offer a targeted retry. A failed write is
//   logged here; successful ones are already visible in the returned results.

import { setRouterClientPaused } from "../../lib/routerClientUpdate";
import type { WifiClientJson } from "@core/dishClient";

export interface PauseTarget {
  clientId: number;
  name: string;
}

export type DeviceOutcome = "success" | "failed";

export interface PauseResult {
  clientId: number;
  name: string;
  outcome: DeviceOutcome;
  error?: string;
}

export interface BulkPauseProgress {
  done: number;
  total: number;
  results: PauseResult[];
}

export type ProgressCallback = (progress: BulkPauseProgress) => void;

/**
 * Pause or unpause every device in `targets` serially.
 *
 * Reports progress after each write so the UI can show "Pausing 3 of 7…"
 * rather than a bare spinner. Never throws — all errors are captured in
 * `PauseResult.outcome === "failed"`.
 */
export async function applyPauseAll(
  targets: PauseTarget[],
  pausing: boolean,
  onProgress: ProgressCallback,
): Promise<PauseResult[]> {
  const results: PauseResult[] = [];

  for (const target of targets) {
    let outcome: DeviceOutcome = "success";
    let error: string | undefined;
    try {
      await setRouterClientPaused(target.clientId, pausing);
    } catch (err) {
      outcome = "failed";
      error = (err as Error).message ?? "Unknown error";
      console.warn(
        `[pauseAll] failed to ${pausing ? "pause" : "unpause"} ${target.name}: ${error}`,
      );
    }
    results.push({ clientId: target.clientId, name: target.name, outcome, error });
    onProgress({ done: results.length, total: targets.length, results: [...results] });
  }

  return results;
}

/**
 * Build the list of devices that should be acted on for a pause or unpause.
 *
 * - Never includes the viewer's own device.
 * - `pausing=true`  → only devices not yet paused (idempotent, skips already-paused).
 * - `pausing=false` → only devices currently paused.
 */
export function pauseTargets(
  devices: WifiClientJson[],
  selfClientId: number | undefined,
  pausing: boolean,
): PauseTarget[] {
  return devices
    .filter((d) => {
      if (d.clientId === undefined || d.clientId === selfClientId) return false;
      return pausing ? d.blocked !== true : d.blocked === true;
    })
    .map((d) => ({
      clientId: d.clientId!,
      name: d.givenName ?? d.macAddress ?? String(d.clientId),
    }));
}

/** Devices the button can ever act on (non-self, have a clientId). */
export function pauseableDevices(
  devices: WifiClientJson[],
  selfClientId: number | undefined,
): WifiClientJson[] {
  return devices.filter((d) => d.clientId !== undefined && d.clientId !== selfClientId);
}
