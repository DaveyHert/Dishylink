// Loads the dish's writable configuration when the Settings modal opens and
// applies partial changes (only touched fields are written, via apply_* flags).

import { useCallback, useEffect, useRef, useState } from "react";
import { DishClient, type DishConfigJson } from "../lib/dishClient";
import { GrpcWebError } from "../lib/grpcWeb";

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
      .catch((loadError) => !disposed && setError(`Couldn't read dish config: ${(loadError as Error).message}`))
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
        // Status 7 = the dish's local-access lock, same one that gates
        // get_location — not a bug in the request.
        if (saveError instanceof GrpcWebError && saveError.grpcStatus === 7) {
          setError(
            "The dish refused the write (permission denied). Config changes over the local network are locked on this " +
              "firmware/plan — flip “Allow access on local network” in the official app (Settings → Advanced), then retry.",
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
