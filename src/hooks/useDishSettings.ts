// Loads the dish's writable configuration while the Settings modal is open and
// applies partial changes (only touched fields are written, via apply_* flags).

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { DishClient, type DishConfigJson } from "@core/dishClient";
import { GrpcWebError } from "@core/grpcWeb";
import {
  readDishSettings,
  setDishConfig,
  setDishSettingsError,
  subscribeToDishSettings,
  type DishConfig,
} from "../lib/dishSettingsStore";

export interface DishSettingsState {
  config: DishConfig | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  /** Apply a partial change; resolves after the dish confirms + config reloads. */
  save: (changes: DishConfigJson) => Promise<void>;
  refresh: () => Promise<void>;
}

// One client for the process. DishClient.load refetches and reparses the
// ~161 KB protoset every call, so reopening the modal must not build another.
let dishClientPromise: Promise<DishClient> | null = null;
export const loadDishClient = () => (dishClientPromise ??= DishClient.load("dish"));

export function useDishSettings(): DishSettingsState {
  const { config, error } = useSyncExternalStore(subscribeToDishSettings, readDishSettings);
  const [saving, setSaving] = useState(false);

  // Nothing to show and nothing gone wrong means the read is still out.
  const loading = config === null && error === null;

  const loadConfig = useCallback(async () => {
    const dishClient = await loadDishClient();
    setDishConfig(await dishClient.getConfig());
  }, []);

  useEffect(() => {
    let disposed = false;
    loadConfig().catch(
      (loadError) =>
        !disposed &&
        setDishSettingsError(`Couldn't read dish config: ${(loadError as Error).message}`),
    );
    return () => {
      disposed = true;
    };
  }, [loadConfig]);

  const save = useCallback(
    async (changes: DishConfigJson) => {
      setSaving(true);
      setDishSettingsError(null);
      try {
        const dishClient = await loadDishClient();
        await dishClient.setConfig(changes);
        await loadConfig();
      } catch (saveError) {
        // Status 7 = the firmware's LAN write lock (measured 2026-07: every
        // write RPC on dish and router refuses LAN callers; only the official
        // app's cloud path can write). Nothing local unlocks it — not a bug in
        // the request, and no setting to flip.
        if (saveError instanceof GrpcWebError && saveError.grpcStatus === 7) {
          setDishSettingsError(
            "The dish refused the write (permission denied). Starlink's current firmware only accepts config changes " +
              "through its own cloud, so local tools are read-only here — use the official Starlink app to change this.",
          );
        } else {
          setDishSettingsError(`Dish refused the change: ${(saveError as Error).message}`);
        }
        throw saveError;
      } finally {
        setSaving(false);
      }
    },
    [loadConfig],
  );

  return { config, loading, error, saving, save, refresh: loadConfig };
}
