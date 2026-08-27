// Drill-in for one client device: identity header with rename, the spec sheet,
// and its throughput charts.

import { useEffect, useState } from "react";
import { throughputMbps, type WifiClientJson } from "@core/dishClient";
import { usageKey, type ClientUsageTotal } from "@core/clientUsage";
import type { TelemetrySample } from "@core/telemetry";
import type { ThroughputRates } from "@core/throughputTracker";
import { classifyDevice } from "../../lib/deviceKind";
import { vendorForMac } from "../../lib/macVendor";
import { DeviceTypeIcon } from "../../assets/icons/DeviceTypeIcon";
import { Badge } from "../ui/badge";
import { DeviceFactsList } from "./DeviceFactsList";
import { DeviceNameEditor, RenameButton } from "./DeviceNameEditor";
import { DeviceSignalIcon } from "../../assets/icons/DeviceSignalIcon";
import { MeterIcon } from "../../assets/icons/MeterIcon";
import { METER_INDICATOR_COLOR, meterIndicatorForRule } from "./rules/meterIndicator";
import { DeviceThroughput } from "./DeviceThroughput";
import { DataMeterDialog } from "./rules/DataMeterDialog";
import type { MemberCandidate } from "./rules/allowanceTerms";
import { useDataMeter } from "../../hooks/useDataMeter";
import { buildDeviceFacts } from "./deviceFacts";
import { deviceRowSubtitle } from "./deviceRowSubtitle";
import { displayName, pauseSettleTimeoutMs, signalQuality } from "./networkFormat";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { SpinLoader } from "../loaders/SpinLoader";
import {
  AccountRequiredError,
  clientPauseControlAvailable,
  setRouterClientPaused,
} from "../../lib/routerClientUpdate";
import { AccountRequiredNotice } from "../shared/AccountRequiredNotice";
import { useCloudAccount } from "../../hooks/useCloudAccount";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

export function DeviceDetail({
  client,
  history,
  rates,
  liveRatesAvailable,
  historianAnswering,
  routerReachable,
  rosterRefreshMs,
  total,
  upstreamName,
  isThisDevice,
  viewerIdentified,
  meterCandidates,
  onRename,
}: {
  client: WifiClientJson;
  /** Every device a limit set here could be extended to cover. */
  meterCandidates: MemberCandidate[];
  /** Live per-MAC rates from the hook's byte-delta tracker. */
  rates: Map<string, ThroughputRates>;
  /** Whether that tracker is still being fed. It runs on the LAN, so a roster
   *  sourced from the account has no current entry in it — only whatever it held
   *  when the router last answered, which would be shown as if it were live. */
  liveRatesAvailable: boolean;
  /** The historian feeds the charts and the router feeds the roster, so an empty
   *  chart has to name whichever of the two is silent. */
  historianAnswering: boolean | null;
  routerReachable: boolean | null;
  /** How often the roster on screen is re-read, which is how long a pause can
   *  take to be confirmed. */
  rosterRefreshMs: number;
  history: TelemetrySample[];
  /** This device's monthly usage from the historian's odometer, if it has one. */
  total?: ClientUsageTotal;
  /** Resolved name of the node this client is attached to (via upstreamMacAddress). */
  upstreamName?: string;
  /** True when this is the device viewing the dashboard. */
  isThisDevice: boolean;
  /** Whether the viewer's own device could be resolved at all. False makes
   *  `isThisDevice` meaningless, since nothing can match an unknown identity. */
  viewerIdentified: boolean;
  onRename: (clientId: number, givenName: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [editingMeter, setEditingMeter] = useState(false);
  const [pendingPaused, setPendingPaused] = useState<boolean | null>(null);
  const [confirmingPause, setConfirmingPause] = useState(false);
  const [pauseError, setPauseError] = useState<Error | null>(null);
  const paused = client.blocked === true;
  // The roster agreeing with what was asked is what ends the pending state, and
  // adjusting it here rather than in an effect keeps the label from rendering one
  // frame of the stale value first.
  if (pendingPaused !== null && paused === pendingPaused) setPendingPaused(null);
  const pauseBusy = pendingPaused !== null && paused !== pendingPaused;
  const { status: cloudStatus } = useCloudAccount(true);
  const meter = useDataMeter(
    client.macAddress ? usageKey(client.clientId, client.macAddress) : null,
  );
  // A pause a rule is holding, as against one someone set by hand: the row in the
  // list already tells the two apart, and the detail behind it has to agree.
  const heldByRule = meter.rules.some((rule) => rule.holding);
  const showPauseControl = clientPauseControlAvailable({
    clientId: client.clientId,
    isThisDevice,
    viewerIdentified,
    cloudConnected: cloudStatus === "ready",
  });
  // The recorder counts a limit with or without an account, so only the pause
  // write needs one.
  const showMeterControl = clientPauseControlAvailable({
    clientId: client.clientId,
    isThisDevice,
    viewerIdentified,
    cloudConnected: true,
  });

  useEffect(() => {
    if (pendingPaused === null) return;
    const timer = window.setTimeout(() => {
      setPendingPaused(null);
      setPauseError(
        new Error("The router has not applied this yet. Give it a moment, then try again."),
      );
    }, pauseSettleTimeoutMs(rosterRefreshMs));
    return () => {
      window.clearTimeout(timer);
    };
  }, [pendingPaused, rosterRefreshMs]);

  const applyPaused = async (next: boolean) => {
    if (client.clientId === undefined || pauseBusy || !showPauseControl) return;
    setPendingPaused(next);
    setPauseError(null);
    try {
      await setRouterClientPaused(client.clientId, next);
    } catch (error) {
      setPendingPaused(null);
      setPauseError(error as Error);
    }
  };

  const quality = signalQuality(client);
  const name = displayName(client);
  // Byte-delta rate, so the headline number matches a speed test instead of the
  // router's 60-second average of it. Falls back until the second reading lands.
  const liveRate =
    liveRatesAvailable && client.macAddress
      ? rates.get(usageKey(client.clientId, client.macAddress))
      : undefined;
  const downMbps = liveRatesAvailable
    ? (liveRate?.downMbps ?? throughputMbps(client.rxStats))
    : null;
  const upMbps = liveRatesAvailable ? (liveRate?.upMbps ?? throughputMbps(client.txStats)) : null;

  const facts = buildDeviceFacts({
    client,
    quality,
    vendor: vendorForMac(client.macAddress),
    upstreamName,
    total,
  });

  return (
    <div>
      {/* Three columns with equal 1fr flanks put the middle column on the row's
          true midpoint regardless of the name's length, while the middle column
          is a normal flow child — so a stacked "Paused" pill grows the row to fit
          rather than spilling out of it. */}
      <div className='mb-3.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2.5'>
        <div className='flex min-w-0 items-center gap-2.5'>
          <DeviceTypeIcon
            kind={classifyDevice(name)}
            size={24}
            className='flex-none text-ink-secondary'
          />
          <div className='min-w-0'>
            <div className='flex items-center gap-2'>
              <span className='truncate text-[18px] font-bold text-foreground'>{name}</span>
              {!editing && <RenameButton onClick={() => setEditing(true)} />}
            </div>
            <div className='text-[11.5px] font-medium text-muted-foreground'>
              {deviceRowSubtitle(client, isThisDevice)}
            </div>
          </div>
        </div>
        {/* Signal glyph, then the router's clientId, then a Paused pill — the
            device's headline state, centred like the app. clientId is opaque and
            uint32 (not a serial, not derived from the MAC) but stable across
            re-associations. */}
        <div className='flex flex-col items-center'>
          <span className='flex h-6 items-center'>
            <DeviceSignalIcon client={client} quality={quality} />
          </span>
          {client.clientId !== undefined && (
            <span className='font-mono text-[11px] tabular-nums text-muted-foreground/70'>
              {client.clientId}
            </span>
          )}
          {paused && <Badge className='mt-1'>{heldByRule ? "Paused · limit" : "Paused"}</Badge>}
        </div>
        <div className='flex items-center justify-end gap-1.5'>
          {showMeterControl && client.macAddress && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='ghost'
                  size='sm'
                  aria-label='Data limit'
                  className='cursor-pointer px-2'
                  onClick={() => setEditingMeter(true)}
                >
                  <MeterIcon
                    className={`size-[21px] ${meter.rule ? METER_INDICATOR_COLOR[meterIndicatorForRule(meter.rule)] : ""}`}
                    active={meter.rule !== null}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent side='top'>Data limit</TooltipContent>
            </Tooltip>
          )}
          {showPauseControl && (
            <Button
              variant={paused ? "outline" : "secondary"}
              size='sm'
              className='min-w-[5.5rem] cursor-pointer disabled:cursor-not-allowed disabled:opacity-100'
              disabled={pauseBusy}
              onClick={() => {
                if (paused) void applyPaused(false);
                else setConfirmingPause(true);
              }}
            >
              {pauseBusy ? (
                <SpinLoader
                  variant='segment'
                  size={16}
                  label={pendingPaused ? "Pausing" : "Unpausing"}
                />
              ) : paused ? (
                "Unpause"
              ) : (
                "Pause"
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Pausing is confirmed, unpausing is not: only one of the two takes a device
          off the internet, and the way back is not obvious from the device itself. */}
      <Dialog open={confirmingPause} onOpenChange={setConfirmingPause}>
        <DialogContent
          showCloseButton={false}
          className='glass-panel gap-3 sm:max-w-md'
          overlayClassName='bg-black/30 backdrop-blur-[2px]'
        >
          <DialogHeader>
            <DialogTitle className='text-[19px] leading-snug'>Pause “{name}”?</DialogTitle>
            <DialogDescription className='text-[13.5px] leading-relaxed'>
              This will pause internet access for this device. It stays connected to your network,
              and you can unpause it at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className='mt-2 gap-2'>
            <Button
              variant='outline'
              className='cursor-pointer sm:min-w-28'
              onClick={() => setConfirmingPause(false)}
            >
              Cancel
            </Button>
            <Button
              className='cursor-pointer sm:min-w-28'
              onClick={() => {
                setConfirmingPause(false);
                void applyPaused(true);
              }}
            >
              Pause
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {pauseError && (
        <div className='mb-3 rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-[12px] text-destructive'>
          {pauseError instanceof AccountRequiredError ? (
            <AccountRequiredNotice />
          ) : (
            pauseError.message
          )}
        </div>
      )}

      {client.macAddress && (
        <DataMeterDialog
          meter={meter}
          clientKey={usageKey(client.clientId, client.macAddress)}
          deviceName={name}
          macAddress={client.macAddress}
          candidates={meterCandidates}
          open={editingMeter}
          onOpenChange={setEditingMeter}
        />
      )}

      {editing && (
        <DeviceNameEditor
          // Remount on a different device so the draft never carries over.
          key={client.macAddress}
          client={client}
          onRename={onRename}
          onDone={() => setEditing(false)}
        />
      )}

      <DeviceFactsList facts={facts} />

      <DeviceThroughput
        history={history}
        downMbps={downMbps}
        upMbps={upMbps}
        historianAnswering={historianAnswering}
        routerReachable={routerReachable}
      />
    </div>
  );
}
