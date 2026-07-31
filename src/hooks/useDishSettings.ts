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
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const clientRef = useRef<Promise<DishClient> | null>(null);

  // Open with nothing to show and nothing gone wrong means the read is still out.
  // Derived rather than set at the top of the effect below, so opening the modal
  // does not spend a render announcing that it is about to start. Reopening keeps
  // the config already read and refreshes it underneath, instead of blanking to a
  // spinner for a value it still holds.
  const loading = active && config === null && error === null;

  const loadConfig = useCallback(async () => {
    clientRef.current ??= DishClient.load("dish");
    const dishClient = await clientRef.current;
    setConfig(await dishClient.getConfig());
  }, []);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    loadConfig()
      // Clears a previous failure only once a read has actually succeeded, so a
      // reopen after an error keeps showing it until there is something better.
      .then(() => !disposed && setError(null))
      .catch(
        (loadError) =>
          !disposed && setError(`Couldn't read dish config: ${(loadError as Error).message}`),
      );
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
