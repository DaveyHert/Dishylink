// Hardware, alignment, GPS, and network facts from the live status message.

import type { DishStatusJson, DishReadyStatesJson } from "@core/dishClient";
import { routerPresence } from "@core/routerPresence";
import { dishModelFor, specForModel } from "../../lib/dishMesh";
import { formatAttitudeState, formatRelativeTime, formatUptime } from "../../lib/format";
import { FactGrid, FactRow } from "../ui/fact-row";
import { DishIcon } from "../../assets/icons/DishIcon";
import { ExpandIcon } from "../../assets/icons/ExpandIcon";
import { formatServiceClass } from "./serviceClass";

/** Why downlink is capped, if it is. NO_LIMIT / NO_RESTRICTION read as "none". */
function formatBandwidthLimit(reason?: string): string {
  if (!reason || reason === "NO_LIMIT" || reason === "NO_RESTRICTION") return "none";
  return reason.replaceAll("_", " ").toLowerCase();
}

/** Subsystem health as one line: "all ready", or the ones that aren't. proto3
 *  drops false, so a subsystem is ready only when explicitly true. */
function readyStatesFact(states?: DishReadyStatesJson): DeviceFact {
  if (!states) return { label: "Subsystems", value: "—" };
  const known: [string, boolean | undefined][] = [
    ["SCP", states.scp],
    ["L1L2", states.l1l2],
    ["XPHY", states.xphy],
    ["AAP", states.aap],
    ["RF", states.rf],
  ];
  const down = known.filter(([, ready]) => ready !== true).map(([name]) => name);
  if (down.length === 0) return { label: "Subsystems", value: "all ready", tone: "good" };
  return { label: "Subsystems", value: `${down.join(", ")} coming up`, tone: "warn" };
}

interface DeviceFact {
  label: string;
  value: string;
  /** Colors the value when the fact is a health signal (e.g. weather). */
  tone?: "good" | "warn" | "bad";
}

const TONE_VAR: Record<NonNullable<DeviceFact["tone"]>, string> = {
  good: "--status-good",
  warn: "--chart-warm",
  bad: "--status-critical",
};

/**
 * Weather-derived signal condition from the dish's own SNR flags. It has no rain
 * gauge — it infers weather from the signal: SNR staying persistently low is the
 * pattern rain fade makes, and is what raises the dish's RAIN_SNR alert. Below
 * the noise floor is worse still. Absent flags (proto3 drops false) mean clear.
 */
function signalCondition(status: DishStatusJson): DeviceFact {
  if (status.isSnrPersistentlyLow) {
    return { label: "Signal", value: "weather affecting signal", tone: "warn" };
  }
  if (status.isSnrAboveNoiseFloor === false) {
    return { label: "Signal", value: "weak — below noise floor", tone: "bad" };
  }
  if (status.isSnrAboveNoiseFloor) {
    return { label: "Signal", value: "normal", tone: "good" };
  }
  return { label: "Signal", value: "—" };
}

export function DishTerminalCard({
  status,
  expanded = false,
  stale = false,
  lastStatusAtMs = null,
  onExpand,
}: {
  status: DishStatusJson;
  /** True in the popup: renders bare (no card chrome/title) inside the panel.
   *  Both views show every fact; the panel just gives it its own width. */
  expanded?: boolean;
  /** True while the dish isn't answering: the facts below are the last known
   *  snapshot, not live, and the header says so. */
  stale?: boolean;
  /** When the dish last answered, so the stale badge can say how old this is. */
  lastStatusAtMs?: number | null;
  /** When set on the card, an expand icon opens the full popup view. */
  onExpand?: () => void;
}) {
  const alignment = status.alignmentStats;
  // The dish's position/navigation filter, in the app's own vocabulary
  // ("Converged"). Null when the dish doesn't report it.
  const positionState = formatAttitudeState(status.gpsStats?.pntFilterConvergenceState);

  const facts: DeviceFact[] = [
    { label: "Model", value: specForModel(dishModelFor(status)).displayName },
    signalCondition(status),
    { label: "Hardware", value: status.deviceInfo?.hardwareVersion ?? "—" },
    { label: "Firmware", value: status.deviceInfo?.softwareVersion ?? "—" },
    { label: "Country", value: status.deviceInfo?.countryCode ?? "—" },
    { label: "Uptime", value: formatUptime(Number(status.deviceState?.uptimeS ?? 0)) },
    { label: "Boot count", value: String(status.deviceInfo?.bootcount ?? "—") },
    {
      label: "Service class",
      value: formatServiceClass(status.classOfService, status.mobilityClass),
    },
    {
      label: "Satellites in View (GPS)",
      value: status.gpsStats?.gpsValid ? `${status.gpsStats.gpsSats ?? 0} satellites` : "no fix",
    },
    {
      // "GPS fix" is receiver jargon — a "fix" is a computed position — and it
      // read as though something had been repaired. What the row answers is
      // whether the dish knows where it is, so it says that.
      //
      // The state clause only appears when the filter is NOT converged: settled is
      // the healthy case, and "filter converged" would sit there permanently saying
      // nothing. An absent state stays silent rather than printing a dash, which
      // would read as a fault where there is none.
      label: "Position",
      value: !status.gpsStats?.gpsValid
        ? "no fix"
        : positionState && positionState !== "Converged"
          ? `locked · ${positionState}`
          : "locked",
      // Green whenever the dish has a position. An absent state is unknown, not
      // a fault, so it must not downgrade a perfectly good lock.
      tone: status.gpsStats?.gpsValid && positionState !== "Unconverged" ? "good" : "warn",
    },
    { label: "Ethernet link", value: status.ethSpeedMbps ? `${status.ethSpeedMbps} Mbps` : "—" },
    {
      label: "NAT",
      value: (status.natFlag ?? "—").replace("NAT_", "").replaceAll("_", " ").toLowerCase(),
    },
    {
      // The dish sends router identities, not a count — keep both: the count
      // reads at a glance, the ids say which routers. The controller counts here
      // too, so this is every router the dish is talking to, mesh or not.
      label: "Downstream routers",
      value: status.connectedRouters?.length
        ? `${status.connectedRouters.length} · ${status.connectedRouters.join(", ")}` +
          (routerPresence(status) === "bypassed" ? " · bypassed" : "")
        : "0",
    },
    { label: "Bandwidth limit", value: formatBandwidthLimit(status.dlBandwidthRestrictedReason) },
    readyStatesFact(status.readyStates),
    {
      label: "Boresight",
      value: alignment
        ? `az ${alignment.boresightAzimuthDeg?.toFixed(1)}° · el ${alignment.boresightElevationDeg?.toFixed(1)}°`
        : "—",
    },
    {
      label: "Tilt",
      value: alignment?.tiltAngleDeg !== undefined ? `${alignment.tiltAngleDeg.toFixed(1)}°` : "—",
    },
    { label: "Software update", value: (status.softwareUpdateState ?? "—").toLowerCase() },
  ];

  // Pending-update banner: a reboot is scheduled when the countdown is ≥ 0
  // (−1 = nothing pending), or the updater is mid-flight (not IDLE).
  const rebootSeconds = status.secondsUntilSwupdateRebootPossible ?? -1;
  const updateState = status.softwareUpdateState ?? "";
  const updateBanner =
    rebootSeconds >= 0
      ? `Update ready — reboot possible in ${formatUptime(rebootSeconds)}`
      : updateState && updateState !== "IDLE"
        ? `Software update: ${updateState.replaceAll("_", " ").toLowerCase()}`
        : null;

  return (
    <div className={expanded ? "" : "col-span-12 min-w-0 rounded-xl bg-card px-[18px] py-4"}>
      <div className='mb-2.5 flex items-center justify-between gap-3'>
        {!expanded && (
          <span className='flex items-center gap-2 text-[16px] font-semibold tracking-[0.005em] text-foreground'>
            <DishIcon size={26} className={stale ? "opacity-40" : undefined} />
            Starlink Dish Terminal
          </span>
        )}
        <div className='flex items-center gap-2.5'>
          {/* Same wording as the alerts panel's Status header for this state. */}
          {stale && (
            <span className='text-[12px] font-medium' style={{ color: "var(--status-critical)" }}>
              {/* "last known" alone left the reader unable to tell a five-second
                  gap from a five-hour one, while every figure below still looked
                  live. Say how old the snapshot actually is. */}
              not answering ·{" "}
              {lastStatusAtMs ? `from ${formatRelativeTime(lastStatusAtMs)}` : "last known"}
            </span>
          )}
          <span className='font-mono text-[12px] font-medium text-muted-foreground tabular-nums'>
            {status.deviceInfo?.id ?? ""}
          </span>
          {onExpand && (
            <button
              className='inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-muted-foreground transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,var(--surface))] hover:text-foreground'
              onClick={onExpand}
              aria-label='Open full terminal view'
            >
              <ExpandIcon />
            </button>
          )}
        </div>
      </div>
      {updateBanner && (
        <div className='mb-3 flex items-center gap-2 rounded-md bg-[color-mix(in_srgb,var(--chart-warm)_14%,var(--surface))] px-3 py-[9px] text-[13px] font-semibold text-chart-warm'>
          ↻ {updateBanner}
        </div>
      )}
      <FactGrid columns={3}>
        {facts.map((fact) => (
          <FactRow key={fact.label} label={fact.label}>
            <span
              className='overflow-hidden text-right font-mono text-[12px] text-ellipsis whitespace-nowrap text-foreground tabular-nums'
              style={fact.tone ? { color: `var(${TONE_VAR[fact.tone]})` } : undefined}
            >
              {fact.value}
            </span>
          </FactRow>
        ))}
      </FactGrid>
    </div>
  );
}
