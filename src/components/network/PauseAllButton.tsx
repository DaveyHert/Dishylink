// "Pause all" / bedtime-mode button for the Connected tab.
//
// Phase 1 — Reliability:
//   - Partial failure recovery: each device's outcome is recorded; failed
//     devices are named, and "Retry failed" re-runs only those, in the same
//     direction as the run that failed them.
//   - Accurate state: derived entirely from the live roster's `blocked` flag,
//     never from local optimistic state, so the button can never claim a pause
//     that the router did not take.
//   - Safe unpause: only devices currently paused are targeted.
//   - Duplicate-submission guard: the button and the dialog's action are both
//     disabled while a run is in flight.
//
// Phase 3 — UX:
//   - Device-level status: the confirm dialog lists devices with their live
//     paused/active badge, so what will change is visible before it happens.
//   - Progress feedback: a "3 of 7" counter while the run is in flight.
//   - Partial-failure summary with a targeted retry.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircleIcon, MoonIcon, RefreshCwIcon } from "lucide-react";
import type { WifiClientJson } from "@core/dishClient";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { SpinLoader } from "../loaders/SpinLoader";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  applyPauseAll,
  pauseableDevices,
  pauseTargets,
  type BulkPauseProgress,
  type PauseResult,
  type PauseTarget,
} from "./pauseAllService";

export function PauseAllButton({
  devices,
  selfClientId,
  disabled,
}: {
  devices: WifiClientJson[];
  selfClientId: number | undefined;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<BulkPauseProgress | null>(null);
  const [results, setResults] = useState<PauseResult[] | null>(null);
  /** Which way the last run went, so a retry repeats it rather than flipping it. */
  const [lastDirection, setLastDirection] = useState<"pause" | "unpause">("pause");

  // State comes from the roster, never from what we asked for.
  const pauseable = pauseableDevices(devices, selfClientId);
  const anyPaused = pauseable.some((d) => d.blocked === true);
  const busy = progress !== null;

  const failed = results?.filter((result) => result.outcome === "failed") ?? [];

  const run = async (pausing: boolean, targets: PauseTarget[]) => {
    if (busy || targets.length === 0) return;
    setLastDirection(pausing ? "pause" : "unpause");
    setResults(null);
    setProgress({ done: 0, total: targets.length, results: [] });
    const final = await applyPauseAll(targets, pausing, (next) => setProgress({ ...next }));
    setProgress(null);
    setResults(final);
  };

  if (pauseable.length === 0) return null;

  const directionLabel =
    lastDirection === "pause" ? t("pauseAll.pausing") : t("pauseAll.unpausing");

  return (
    <>
      <Button
        variant={anyPaused ? "outline" : "secondary"}
        size='sm'
        disabled={disabled || busy}
        className='flex cursor-pointer items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-70'
        onClick={() => {
          if (anyPaused) void run(false, pauseTargets(devices, selfClientId, false));
          else {
            setResults(null);
            setConfirming(true);
          }
        }}
      >
        {busy ? (
          <SpinLoader variant='segment' size={14} label={directionLabel} />
        ) : (
          <MoonIcon className='size-3.5' />
        )}
        {busy && progress
          ? `${directionLabel} ${t("pauseAll.progress", {
              done: progress.done,
              total: progress.total,
            })}`
          : anyPaused
            ? t("pauseAll.unpauseAll")
            : t("pauseAll.pauseAll")}
      </Button>

      {!busy && failed.length > 0 && (
        <span className='flex items-center gap-1.5 text-[11.5px] text-destructive'>
          <AlertCircleIcon className='size-3.5 flex-none' />
          <span>{t("pauseAll.partialFail", { count: failed.length })}</span>
          <button
            type='button'
            className='flex cursor-pointer items-center gap-1 underline underline-offset-2 hover:no-underline'
            onClick={() =>
              void run(
                lastDirection === "pause",
                failed.map((result) => ({ clientId: result.clientId, name: result.name })),
              )
            }
          >
            <RefreshCwIcon className='size-3' />
            {t("pauseAll.retryFailed")}
          </button>
        </span>
      )}

      <Dialog
        open={confirming}
        onOpenChange={(next) => {
          if (!busy) setConfirming(next);
        }}
      >
        <DialogContent
          showCloseButton={false}
          className='glass-panel gap-3 sm:max-w-md'
          overlayClassName='bg-black/30 backdrop-blur-[2px]'
        >
          <DialogHeader>
            <DialogTitle className='text-[19px] leading-snug'>
              {t("pauseAll.confirmTitle")}
            </DialogTitle>
            <DialogDescription className='text-[13.5px] leading-relaxed'>
              {t("pauseAll.confirmBody", { count: pauseable.length })}
            </DialogDescription>
          </DialogHeader>

          <div className='thin-scroll flex max-h-[200px] flex-col gap-0.5 overflow-y-auto rounded-lg border border-border/50 bg-[color-mix(in_srgb,var(--ink)_3%,transparent)] p-2'>
            {pauseable.map((device) => (
              <div
                key={device.clientId}
                className='flex items-center justify-between gap-2 px-1.5 py-1'
              >
                <span className='truncate text-[12.5px] text-foreground'>
                  {device.givenName ?? device.macAddress ?? String(device.clientId)}
                </span>
                {device.blocked ? (
                  <Badge tone='neutral'>{t("network.paused")}</Badge>
                ) : (
                  <span className='text-[11px] text-muted-foreground'>
                    {t("pauseAll.deviceActive")}
                  </span>
                )}
              </div>
            ))}
          </div>

          <DialogFooter className='mt-1 gap-2'>
            <Button
              variant='outline'
              className='cursor-pointer sm:min-w-28'
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              className='cursor-pointer sm:min-w-28'
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                void run(true, pauseTargets(devices, selfClientId, true));
              }}
            >
              {t("pauseAll.confirmAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
