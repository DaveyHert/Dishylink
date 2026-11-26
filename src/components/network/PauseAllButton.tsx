// "Pause all" / bedtime-mode button for the Connected tab.
//
// Pauses every non-self device in one shot (serially — the cloud gateway
// serialises writes on its own side already, so sending them concurrently would
// just pile them up there). Unpauses with a single click once active.
//
// Pausing every device at once is an intentional action, so a confirmation
// dialog guards the initial press. Unpausing is never confirmed — it only
// restores access, and the way back being one tap is the point.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MoonIcon } from "lucide-react";
import type { WifiClientJson } from "@core/dishClient";
import { setRouterClientPaused } from "../../lib/routerClientUpdate";
import { Button } from "../ui/button";
import { SpinLoader } from "../loaders/SpinLoader";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

export function PauseAllButton({
  devices,
  selfClientId,
  disabled,
}: {
  /** The full roster — only non-self, non-already-paused devices are touched. */
  devices: WifiClientJson[];
  /** The viewer's own clientId so we never pause ourselves. */
  selfClientId: number | undefined;
  /** Grey out the control when the cloud account is not ready. */
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Devices that can be paused by this button.
  const pauseable = devices.filter((d) => d.clientId !== undefined && d.clientId !== selfClientId);
  const allPaused = pauseable.length > 0 && pauseable.every((d) => d.blocked === true);
  const anyPaused = pauseable.some((d) => d.blocked === true);

  const applyAll = async (pausing: boolean) => {
    setBusy(true);
    setError(null);
    const targets = pausing
      ? pauseable.filter((d) => !d.blocked)
      : pauseable.filter((d) => d.blocked);
    try {
      for (const device of targets) {
        if (device.clientId === undefined) continue;
        await setRouterClientPaused(device.clientId, pausing);
      }
    } catch (err) {
      setError((err as Error).message ?? t("pauseAll.error"));
    } finally {
      setBusy(false);
    }
  };

  if (pauseable.length === 0) return null;

  return (
    <>
      <Button
        variant={allPaused || anyPaused ? "outline" : "secondary"}
        size='sm'
        disabled={disabled || busy || pauseable.length === 0}
        className='flex cursor-pointer items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-70'
        onClick={() => {
          if (allPaused || anyPaused) {
            void applyAll(false);
          } else {
            setConfirming(true);
          }
        }}
      >
        {busy ? (
          <SpinLoader
            variant='segment'
            size={14}
            label={allPaused || anyPaused ? t("pauseAll.unpausing") : t("pauseAll.pausing")}
          />
        ) : (
          <MoonIcon className='size-3.5' />
        )}
        {allPaused || anyPaused ? t("pauseAll.unpauseAll") : t("pauseAll.pauseAll")}
      </Button>

      {error && <p className='mt-1 text-[11.5px] text-destructive'>{error}</p>}

      <Dialog open={confirming} onOpenChange={setConfirming}>
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
          <DialogFooter className='mt-2 gap-2'>
            <Button
              variant='outline'
              className='cursor-pointer sm:min-w-28'
              onClick={() => setConfirming(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              className='cursor-pointer sm:min-w-28'
              onClick={() => {
                setConfirming(false);
                void applyAll(true);
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
