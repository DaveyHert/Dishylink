// Loads the dish's writable configuration while the Settings modal is open and
// applies partial changes (only touched fields are written, via apply_* flags).

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { DishClient, type DishConfigJson } from "@core/dishClient";
import { applyDishConfigUpdate } from "../lib/dishConfigUpdate";
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
  error: Error | null;
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
        setDishSettingsError(
          new Error(`Couldn't read dish config: ${(loadError as Error).message}`),
        ),
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
        await applyDishConfigUpdate(changes);
        await loadConfig();
      } catch (saveError) {
        setDishSettingsError(saveError as Error);
        throw saveError;
      } finally {
        setSaving(false);
      }
    },
    [loadConfig],
  );

  return { config, loading, error, saving, save, refresh: loadConfig };
}
