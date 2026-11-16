// Outbound webhook delivery for alert transitions.
//
// Delivers a JSON POST to a user-configured URL whenever an alert fires or
// clears. Supports Slack, Discord, Home Assistant, and any service that
// accepts an HTTP POST with a JSON body.
//
// The payload includes enough context for downstream automations to act on
// it without needing a second request: the metric value, the rule name, and
// whether this is an onset or a recovery.
//
// Delivery is best-effort: a failed webhook is logged but does not affect
// alert recording or notification. The historian calls this fire-and-forget
// from the same poll callback that fires desktop notifications.

import type { AlertTransition } from "./alertEngine";
import type { AlertSpec } from "./alertDefinitions";
import type { CustomAlertTransition } from "./customAlertEngine";
import type { CustomAlertMetric } from "./customAlertRules";

/** The shape of the JSON body sent to the webhook URL. */
export interface WebhookPayload {
  event: "alert.fired" | "alert.cleared" | "digest";
  timestamp: string;
  /** Human-readable summary for services that display it directly. */
  text: string;
  /** Structured data for automations. */
  data: WebhookAlertData | WebhookDigestData;
}

export interface WebhookAlertData {
  kind: "builtin" | "custom";
  key: string;
  name: string;
  severity: string;
  source: string;
  /** Present for custom rules: the actual measured value at transition time. */
  value?: number;
  metric?: CustomAlertMetric;
}

export interface WebhookDigestData {
  kind: "digest";
  periodStart: string;
  periodEnd: string;
  dataUsedGb: number | null;
  peakDownloadMbps: number | null;
  uptimePercent: number | null;
  outageCount: number;
  worstOutageCause: string | null;
}

/** Webhook configuration stored in the app settings. */
export interface WebhookConfig {
  url: string;
  /** Whether to fire on built-in alert transitions. */
  builtinAlerts: boolean;
  /** Whether to fire on custom rule transitions. */
  customAlerts: boolean;
  /** Whether to fire the daily digest. */
  digest: boolean;
}

/** Validate a webhook URL. Returns null if valid, an error string if not. */
export function validateWebhookUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "URL must start with http:// or https://";
    }
    return null;
  } catch {
    return "Enter a valid URL";
  }
}

function slackText(payload: WebhookPayload): object {
  // Slack's incoming webhook format expects a `text` field.
  return { text: payload.text, username: "Dishylink", icon_emoji: ":satellite:" };
}

function discordText(payload: WebhookPayload): object {
  // Discord expects a `content` field.
  return { content: payload.text, username: "Dishylink" };
}

/**
 * Telegram Bot API: POST to sendMessage with chat_id + text.
 * The chat_id is read from the ?chat_id= query param that the user appends
 * to their webhook URL, e.g.:
 *   https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>
 * If chat_id is missing from the URL we fall back to the generic payload so
 * the error is visible rather than silently swallowed.
 */
function telegramText(url: string, payload: WebhookPayload): object {
  const chatId = new URL(url).searchParams.get("chat_id");
  if (!chatId) return payload;
  return { chat_id: chatId, text: payload.text, parse_mode: "HTML" };
}

/** Detect the service from the URL and wrap accordingly. */
function wrapPayload(url: string, payload: WebhookPayload): object {
  const lower = url.toLowerCase();
  if (lower.includes("hooks.slack.com")) return slackText(payload);
  if (lower.includes("discord.com/api/webhooks")) return discordText(payload);
  if (lower.includes("api.telegram.org/bot")) return telegramText(url, payload);
  // Generic: send the full structured payload.
  return payload;
}

/** Build a webhook payload for a built-in alert transition.
 *  `title` and `body` are the already-translated notification strings. */
export function builtinTransitionPayload(
  transition: AlertTransition,
  spec: AlertSpec,
  title: string,
  body: string,
): WebhookPayload {
  const event = transition.kind === "fired" ? "alert.fired" : "alert.cleared";
  return {
    event,
    timestamp: new Date(transition.atMs).toISOString(),
    text: `${title}: ${body}`,
    data: {
      kind: "builtin",
      key: transition.key,
      name: body,
      severity: spec.severity,
      source: transition.source,
    },
  };
}

/** Build a webhook payload for a custom rule transition. */
export function customTransitionPayload(transition: CustomAlertTransition): WebhookPayload {
  const { rule, value, atMs } = transition;
  const event = transition.kind === "fired" ? "alert.fired" : "alert.cleared";
  const condStr = rule.condition === "above" ? "exceeded" : "dropped below";
  const text =
    transition.kind === "fired"
      ? `Custom alert "${rule.name}": ${rule.metric} ${condStr} ${rule.threshold} (current: ${value.toFixed(1)})`
      : `Custom alert "${rule.name}" cleared (${rule.metric} back within bounds)`;

  return {
    event,
    timestamp: new Date(atMs).toISOString(),
    text,
    data: {
      kind: "custom",
      key: rule.id,
      name: rule.name,
      severity: "warning",
      source: "custom",
      value,
      metric: rule.metric,
    },
  };
}

/** Build a webhook payload for the daily digest. */
export function digestPayload(data: WebhookDigestData): WebhookPayload {
  const lines: string[] = ["📊 Daily Dishylink digest"];
  if (data.uptimePercent !== null) lines.push(`• Uptime: ${data.uptimePercent.toFixed(1)}%`);
  if (data.peakDownloadMbps !== null)
    lines.push(`• Peak download: ${data.peakDownloadMbps.toFixed(0)} Mbps`);
  if (data.dataUsedGb !== null) lines.push(`• Data used: ${data.dataUsedGb.toFixed(2)} GB`);
  if (data.outageCount > 0)
    lines.push(
      `• Outages: ${data.outageCount}${data.worstOutageCause ? ` (worst: ${data.worstOutageCause})` : ""}`,
    );

  return {
    event: "digest",
    timestamp: new Date().toISOString(),
    text: lines.join("\n"),
    data,
  };
}

/** POST a payload to the webhook URL. Returns true on 2xx, false otherwise.
 *  Never throws — callers should not await this in a hot path. */
export async function postWebhook(
  config: WebhookConfig,
  payload: WebhookPayload,
): Promise<boolean> {
  const body = wrapPayload(config.url, payload);
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch (error) {
    console.warn(`[webhook] delivery failed: ${(error as Error).message}`);
    return false;
  }
}
