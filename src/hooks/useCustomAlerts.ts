// Fetches and mutates custom alert rules and webhook settings from the historian.

import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../lib/apiHost";
import type { CustomAlertRule } from "@core/customAlertRules";
import type { WebhookConfig } from "@core/webhookDelivery";

export type { CustomAlertRule };
export type { WebhookConfig };

export interface DigestConfig {
  enabled: boolean;
  hourOfDay: number;
}

export interface WebhookSettings {
  webhook: WebhookConfig | null;
  digest: DigestConfig;
  lastDigestMs: number | null;
}

function emptySettings(): WebhookSettings {
  return { webhook: null, digest: { enabled: false, hourOfDay: 8 }, lastDigestMs: null };
}

// ---- Custom rules ----

export function useCustomRules() {
  const [rules, setRules] = useState<CustomAlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest("/api/custom-rules");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { rules?: CustomAlertRule[] };
      setRules(body.rules ?? []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    async function init() {
      await load();
    }
    void init();
  }, [load]);

  const save = useCallback(
    async (rule: CustomAlertRule): Promise<void> => {
      const params = new URLSearchParams({
        id: rule.id,
        name: rule.name,
        metric: rule.metric,
        condition: rule.condition,
        threshold: String(rule.threshold),
        duration: String(rule.durationSeconds),
        enabled: String(rule.enabled),
      });
      const res = await apiRequest(`/api/custom-rules?${params.toString()}`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    },
    [load],
  );

  const remove = useCallback(async (id: string): Promise<void> => {
    const res = await apiRequest(`/api/custom-rules?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setRules((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const toggle = useCallback(
    async (rule: CustomAlertRule): Promise<void> => {
      await save({ ...rule, enabled: !rule.enabled });
    },
    [save],
  );

  return { rules, loading, error, save, remove, toggle, reload: load };
}

// ---- Webhook / digest settings ----

export function useWebhookSettings() {
  const [settings, setSettings] = useState<WebhookSettings>(emptySettings());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest("/api/webhook-settings");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as WebhookSettings;
      setSettings(body);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    async function init() {
      await load();
    }
    void init();
  }, [load]);

  const setWebhook = useCallback(
    async (config: WebhookConfig | null): Promise<void> => {
      const params = new URLSearchParams({ action: "setWebhook" });
      if (config) {
        params.set("url", config.url);
        params.set("builtinAlerts", String(config.builtinAlerts));
        params.set("customAlerts", String(config.customAlerts));
        params.set("digestWebhook", String(config.digest));
      }
      const res = await apiRequest(`/api/webhook-settings?${params.toString()}`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    },
    [load],
  );

  const setDigest = useCallback(
    async (digest: DigestConfig): Promise<void> => {
      const params = new URLSearchParams({
        action: "setDigest",
        enabled: String(digest.enabled),
        hour: String(digest.hourOfDay),
      });
      const res = await apiRequest(`/api/webhook-settings?${params.toString()}`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    },
    [load],
  );

  const testWebhook = useCallback(async (): Promise<boolean> => {
    const res = await apiRequest("/api/webhook-settings?action=testWebhook", { method: "POST" });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  }, []);

  return { settings, loading, error, setWebhook, setDigest, testWebhook, reload: load };
}
