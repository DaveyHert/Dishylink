// Loads the dish's writable configuration when the Settings modal opens and
// applies partial changes (only touched fields are written, via apply_* flags).

import { useCallback, useEffect, useRef, useState } from "react";
import { DishClient, type DishConfigJson } from "@core/dishClient";
import { GrpcWebError } from "@core/grpcWeb";

export interface DishSettingsState {
  config: (DishConfigJson & Record<string, unknown>) | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  /** Apply a partial change; resolves after the dish confirms + config reloads. */
  save: (changes: DishConfigJson) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useDishSettings(active: boolean): DishSettingsState {
  const [config, setConfig] = useState<(DishConfigJson & Record<string, unknown>) | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const clientRef = useRef<Promise<DishClient> | null>(null);

  const loadConfig = useCallback(async () => {
    clientRef.current ??= DishClient.load("dish");
    const dishClient = await clientRef.current;
    setConfig(await dishClient.getConfig());
  }, []);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    setLoading(true);
    setError(null);
    loadConfig()
      .catch(
        (loadError) =>
          !disposed && setError(`Couldn't read dish config: ${(loadError as Error).message}`),
      )
      .finally(() => !disposed && setLoading(false));
    return () => {
      disposed = true;
    };
  }, [active, loadConfig]);

  const save = useCallback(
    async (changes: DishConfigJson) => {
      setSaving(true);
      setError(null);
      try {
        clientRef.current ??= DishClient.load("dish");
        const dishClient = await clientRef.current;
        await dishClient.setConfig(changes);
        await loadConfig();
      } catch (saveError) {
        // Status 7 = the firmware's LAN write lock (measured 2026-07: every
        // write RPC on dish and router refuses LAN callers; only the official
        // app's cloud path can write). Nothing local unlocks it — not a bug in
        // the request, and no setting to flip.
        if (saveError instanceof GrpcWebError && saveError.grpcStatus === 7) {
          setError(
            "The dish refused the write (permission denied). Starlink's current firmware only accepts config changes " +
              "through its own cloud, so local tools are read-only here — use the official Starlink app to change this.",
          );
        } else {
          setError(`Dish refused the change: ${(saveError as Error).message}`);
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
