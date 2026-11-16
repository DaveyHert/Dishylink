// Integration module for custom alert rules, webhooks, and the daily digest.
//
// Instantiated once by historian.mts after stores are initialized. Provides:
//   - runCustomAlerts(): called each 5s poll cycle to evaluate user-defined rules.
//   - dispatchBuiltinWebhook(): called for every built-in alert transition.
//   - checkAndSendDigest(): called every 5 min to fire the once-daily digest.
//   - handleCustomRulesRequest(): serves /api/custom-rules (GET/POST/DELETE).
//   - handleWebhookSettingsRequest(): serves /api/webhook-settings (GET/POST).

import { CustomRuleStore } from "./customRuleStore.mts";
import { WebhookStore } from "./webhookStore.mts";
import { CustomAlertEngine, type CustomSample } from "../core/customAlertEngine.ts";
import {
  builtinTransitionPayload,
  customTransitionPayload,
  digestPayload,
  postWebhook,
  type WebhookDigestData,
} from "../core/webhookDelivery.ts";
import type { AlertTransition } from "../core/alertEngine.ts";
import type { TelemetrySample } from "../core/telemetry.ts";

export { CustomRuleStore, WebhookStore };

/** Sparse event shape we need from EventStore for the digest. */
interface DigestEvent {
  startMs?: number;
  durationMs?: number;
  cause?: string;
}

/** Sparse energy bucket shape we need from EnergyStore for the digest.
 *  Matches MinuteBucket from core/energyBuckets.ts. */
interface DigestBucket {
  wattSeconds: number;
  samples: number;
  downlinkBits?: number;
  uplinkBits?: number;
}

export class CustomFeatures {
  readonly customRuleStore: CustomRuleStore;
  readonly webhookStore: WebhookStore;
  private readonly customAlertEngine: CustomAlertEngine;

  constructor(
    dataDir: string,
    private readonly getLatestSamples: () => TelemetrySample[],
    private readonly getAllEvents: () => DigestEvent[],
    private readonly readEnergyRange: (startSec: number, endSec: number) => DigestBucket[],
  ) {
    this.customRuleStore = new CustomRuleStore(`${dataDir}/custom-rules.json`);
    this.webhookStore = new WebhookStore(`${dataDir}/webhook-settings.json`);
    this.customAlertEngine = new CustomAlertEngine();
  }

  // ---- Webhook delivery for built-in alerts ----

  dispatchBuiltinWebhook(transition: AlertTransition): void {
    const settings = this.webhookStore.get();
    if (!settings.webhook?.builtinAlerts) return;
    const { spec } = transition;
    const title =
      transition.kind === "fired"
        ? `Dishylink alert: ${transition.source}`
        : `Dishylink resolved: ${transition.source}`;
    const body = String(transition.kind === "fired" ? spec.firing : spec.ok);
    const payload = builtinTransitionPayload(transition, spec, title, body);
    void postWebhook(settings.webhook, payload).catch(() => {});
  }

  // ---- Custom rule evaluation ----

  runCustomAlerts(): void {
    const latestSamples = this.getLatestSamples();
    if (latestSamples.length === 0) return;
    const last = latestSamples[latestSamples.length - 1];
    const sample: CustomSample = {
      timestampMs: last.timestampMs,
      downloadMbps: (last.downlinkBps ?? 0) / 1_000_000,
      uploadMbps: (last.uplinkBps ?? 0) / 1_000_000,
      latencyMs: last.latencyMs ?? 0,
      pingSuccessPercent:
        last.routerPingSuccessPercent != null
          ? last.routerPingSuccessPercent
          : (1 - (last.dropRate ?? 0)) * 100,
      powerWatts: Number.isFinite(last.powerW) ? last.powerW : null,
      obstructionPercent: null,
    };
    const rules = this.customRuleStore.all();
    const transitions = this.customAlertEngine.update(rules, sample);
    for (const transition of transitions) {
      const dir = transition.kind === "fired" ? "fired" : "cleared";
      console.log(
        `[historian] custom alert ${dir}: "${transition.rule.name}" (${transition.rule.metric}=${transition.value.toFixed(2)})`,
      );
      const settings = this.webhookStore.get();
      if (settings.webhook?.customAlerts) {
        const payload = customTransitionPayload(transition);
        void postWebhook(settings.webhook, payload).catch(() => {});
      }
    }
  }

  // ---- Daily digest ----

  checkAndSendDigest(): void {
    const { digest, webhook, lastDigestMs } = this.webhookStore.get();
    if (!digest.enabled || !webhook?.digest) return;

    const now = new Date();
    const targetMs = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      digest.hourOfDay,
      0,
      0,
      0,
    ).getTime();

    const withinWindow = now.getTime() >= targetMs && now.getTime() < targetMs + 5 * 60_000;
    const sentToday = lastDigestMs !== null && lastDigestMs >= targetMs;
    if (!withinWindow || sentToday) return;

    const dayAgoSec = Math.floor((Date.now() - 86_400_000) / 1_000);
    const nowSec = Math.floor(Date.now() / 1_000);
    const dayBuckets = this.readEnergyRange(dayAgoSec, nowSec);

    // downlinkBits / uplinkBits are bits-per-minute; convert to bytes.
    const totalDownBytes = dayBuckets.reduce((s, b) => s + (b.downlinkBits ?? 0) / 8, 0);
    const totalUpBytes = dayBuckets.reduce((s, b) => s + (b.uplinkBits ?? 0) / 8, 0);
    // Peak download: bits-per-minute bucket → Mbps average for that minute.
    const peakDownMbps =
      dayBuckets.length > 0
        ? Math.max(...dayBuckets.map((b) => (b.downlinkBits ?? 0) / 60 / 1_000_000))
        : null;

    // Uptime: fraction of buckets that had at least one sample recorded.
    const coveredBuckets = dayBuckets.filter((b) => b.samples > 0);
    const uptimePct =
      dayBuckets.length > 0 ? (coveredBuckets.length / dayBuckets.length) * 100 : null;

    const recentEvents = this.getAllEvents().filter((ev) => {
      const startMs = typeof ev.startMs === "number" ? ev.startMs : 0;
      return startMs >= Date.now() - 86_400_000;
    });
    const sortedByDuration = [...recentEvents].sort(
      (a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0),
    );
    const worstCause = sortedByDuration[0]?.cause ?? null;

    const data: WebhookDigestData = {
      kind: "digest",
      periodStart: new Date(Date.now() - 86_400_000).toISOString(),
      periodEnd: new Date().toISOString(),
      dataUsedGb: (totalDownBytes + totalUpBytes) / 1e9,
      peakDownloadMbps: peakDownMbps,
      uptimePercent: uptimePct,
      outageCount: recentEvents.length,
      worstOutageCause: worstCause,
    };

    void postWebhook(webhook, digestPayload(data))
      .then((ok) => {
        if (ok) {
          this.webhookStore.recordDigestSent(Date.now());
          console.log("[historian] daily digest sent");
        } else {
          console.warn("[historian] daily digest delivery failed");
        }
      })
      .catch(() => {});
  }

  // ---- HTTP API handlers ----

  /**
   * Handle /api/custom-rules GET/POST/DELETE.
   * Returns true if handled.
   */
  handleCustomRulesRequest(
    method: string | undefined,
    url: URL,
    respond: (body: string) => void,
  ): boolean {
    if (url.pathname !== "/api/custom-rules") return false;

    if (method === "GET") {
      respond(JSON.stringify({ rules: this.customRuleStore.all() }));
      return true;
    }

    if (method === "POST") {
      const id = url.searchParams.get("id") ?? crypto.randomUUID();
      const name = url.searchParams.get("name")?.trim();
      const metric = url.searchParams.get("metric");
      const condition = url.searchParams.get("condition");
      const threshold = Number(url.searchParams.get("threshold"));
      const durationSeconds = Math.min(
        3600,
        Math.max(0, Number(url.searchParams.get("duration") ?? 0)),
      );
      const enabled = url.searchParams.get("enabled") !== "false";

      const validMetrics = [
        "downloadMbps",
        "uploadMbps",
        "latencyMs",
        "pingSuccessPercent",
        "powerWatts",
        "obstructionPercent",
      ];

      if (
        !name ||
        !metric ||
        !validMetrics.includes(metric) ||
        (condition !== "above" && condition !== "below") ||
        !Number.isFinite(threshold)
      ) {
        respond(JSON.stringify({ error: "bad_request" }));
        return true;
      }

      const rule = {
        id,
        name,
        metric: metric as import("../core/customAlertRules.ts").CustomAlertMetric,
        condition: condition as "above" | "below",
        threshold,
        durationSeconds,
        enabled,
      };
      this.customRuleStore.upsert(rule);
      this.customAlertEngine.sync(this.customRuleStore.all(), Date.now());
      respond(JSON.stringify({ rule }));
      return true;
    }

    if (method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) {
        respond(JSON.stringify({ error: "bad_request" }));
        return true;
      }
      const removed = this.customRuleStore.remove(id);
      respond(JSON.stringify({ removed }));
      return true;
    }

    return false;
  }

  /**
   * Handle /api/webhook-settings GET/POST.
   * Returns true if handled. Async for the test-webhook action.
   */
  handleWebhookSettingsRequest(
    method: string | undefined,
    url: URL,
    respond: (body: string) => void,
  ): boolean {
    if (url.pathname !== "/api/webhook-settings") return false;

    if (method === "GET") {
      respond(JSON.stringify(this.webhookStore.get()));
      return true;
    }

    if (method === "POST") {
      const action = url.searchParams.get("action");

      if (action === "setWebhook") {
        const webhookUrl = url.searchParams.get("url");
        if (!webhookUrl) {
          this.webhookStore.setWebhook(null);
        } else {
          const builtinAlerts = url.searchParams.get("builtinAlerts") !== "false";
          const customAlerts = url.searchParams.get("customAlerts") !== "false";
          const digestEnabled = url.searchParams.get("digestWebhook") !== "false";
          this.webhookStore.setWebhook({
            url: webhookUrl,
            builtinAlerts,
            customAlerts,
            digest: digestEnabled,
          });
        }
        respond(JSON.stringify({ ok: true }));
        return true;
      }

      if (action === "setDigest") {
        const enabled = url.searchParams.get("enabled") === "true";
        const hourOfDay = Math.min(23, Math.max(0, Number(url.searchParams.get("hour") ?? 8)));
        this.webhookStore.setDigest({ enabled, hourOfDay });
        respond(JSON.stringify({ ok: true }));
        return true;
      }

      if (action === "testWebhook") {
        const settings = this.webhookStore.get();
        if (!settings.webhook) {
          respond(JSON.stringify({ ok: false, error: "no_webhook_configured" }));
          return true;
        }
        const testPayload = digestPayload({
          kind: "digest",
          periodStart: new Date().toISOString(),
          periodEnd: new Date().toISOString(),
          dataUsedGb: 1.23,
          peakDownloadMbps: 150,
          uptimePercent: 99.5,
          outageCount: 0,
          worstOutageCause: null,
        });
        testPayload.text = "Dishylink webhook test — if you see this, delivery is working!";
        void postWebhook(settings.webhook, testPayload)
          .then((ok) => respond(JSON.stringify({ ok })))
          .catch(() => respond(JSON.stringify({ ok: false })));
        return true;
      }

      respond(JSON.stringify({ error: "unknown_action" }));
      return true;
    }

    return false;
  }
}
