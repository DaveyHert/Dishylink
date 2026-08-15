// The dish's config outlives the Settings modal so reopening shows the value
// already read instead of blanking to a spinner, and a read failure stays on
// screen until a later read actually succeeds.

import type { DishConfigJson } from "@core/dishClient";

export type DishConfig = DishConfigJson & Record<string, unknown>;

export interface DishSettingsSnapshot {
  config: DishConfig | null;
  error: Error | null;
}

let snapshot: DishSettingsSnapshot = { config: null, error: null };
const listeners = new Set<() => void>();

/** Identity changes only when something was published, which useSyncExternalStore requires. */
export function readDishSettings(): DishSettingsSnapshot {
  return snapshot;
}

export function subscribeToDishSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: DishSettingsSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

/** A successful read: the config lands and any earlier failure is cleared. */
export function setDishConfig(config: DishConfig): void {
  publish({ config, error: null });
}

export function setDishSettingsError(error: Error | null): void {
  if (snapshot.error === error) return;
  publish({ config: snapshot.config, error });
}
