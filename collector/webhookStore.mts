// Persistence for webhook and digest configuration.
//
// Stored as a small JSON file alongside other historian config. Reads and
// writes are always full-replacement — the config object is small and atomic
// writes are safer than patching individual fields.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { WebhookConfig } from "../core/webhookDelivery.ts";

/** Configuration for the daily digest notification. */
export interface DigestConfig {
  /** Whether the daily digest is enabled. */
  enabled: boolean;
  /**
   * Local hour (0–23) at which to send the digest.
   * Defaults to 8 (8 AM).
   */
  hourOfDay: number;
}

export interface WebhookSettings {
  webhook: WebhookConfig | null;
  digest: DigestConfig;
  /** Epoch-ms of the last digest that was successfully sent, or null. */
  lastDigestMs: number | null;
}

const DEFAULTS: WebhookSettings = {
  webhook: null,
  digest: { enabled: false, hourOfDay: 8 },
  lastDigestMs: null,
};

interface Snapshot {
  version: 1;
  settings: WebhookSettings;
}

export class WebhookStore {
  private settings: WebhookSettings = { ...DEFAULTS, digest: { ...DEFAULTS.digest } };

  constructor(private readonly path: string) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as Snapshot;
      if (raw.settings && typeof raw.settings === "object") {
        this.settings = {
          webhook: isValidWebhookConfig(raw.settings.webhook) ? raw.settings.webhook : null,
          digest: isValidDigestConfig(raw.settings.digest)
            ? raw.settings.digest
            : { ...DEFAULTS.digest },
          lastDigestMs:
            typeof raw.settings.lastDigestMs === "number" ? raw.settings.lastDigestMs : null,
        };
      }
    } catch {
      // Corrupt — start from defaults.
    }
  }

  get(): WebhookSettings {
    return this.settings;
  }

  setWebhook(webhook: WebhookConfig | null): void {
    this.settings = { ...this.settings, webhook };
    this.snapshot();
  }

  setDigest(digest: DigestConfig): void {
    this.settings = { ...this.settings, digest };
    this.snapshot();
  }

  recordDigestSent(atMs: number): void {
    this.settings = { ...this.settings, lastDigestMs: atMs };
    this.snapshot();
  }

  private snapshot(): void {
    const tmp = `${this.path}.tmp`;
    const data: Snapshot = { version: 1, settings: this.settings };
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, this.path);
  }
}

function isValidWebhookConfig(v: unknown): v is WebhookConfig {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.url === "string" &&
    typeof c.builtinAlerts === "boolean" &&
    typeof c.customAlerts === "boolean" &&
    typeof c.digest === "boolean"
  );
}

function isValidDigestConfig(v: unknown): v is DigestConfig {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.enabled === "boolean" &&
    typeof c.hourOfDay === "number" &&
    c.hourOfDay >= 0 &&
    c.hourOfDay <= 23
  );
}
