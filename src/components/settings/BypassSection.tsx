// Whether the Starlink router runs the network at all.
//
// Read from the LAN first and the account last. A router answering locally is one
// bypass has not silenced, which settles it outright; the account carries the same
// fact but was measured lagging a flip by minutes, so trusting it first leaves the
// row insisting on bypass while the WiFi is already back.
//
// The account is still what makes the way back reachable: the write rides the
// cloud gateway, which needs some internet rather than Starlink's in particular,
// so a kit with a third-party router wired in can be un-bypassed from the very
// machine that bypassed it.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RouterPresence } from "@core/routerPresence";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SlideToConfirm } from "@/components/ui/slide-to-confirm";
import { SpinLoader } from "../loaders/SpinLoader";
import { errorText } from "../../lib/errorText";
import { SettingRow } from "./settingsChrome";

/** The dish names the role within seconds of a flip, so a wait that outlasts this
 *  is one the dish is not going to end. */
const SETTLE_TIMEOUT_MS = 45_000;

export function BypassSection({
  /** What the account reports, or null when its telemetry carries no controller
   *  row to read it from. */
  reported,
  /** The router is answering on the LAN, which only an un-bypassed router does. */
  routerAnswering,
  /** The dish's read on the routers below it, which names the role in seconds
   *  where the account lags a flip by minutes. */
  dishPresence,
  /** No account connected, so the write has nowhere to go. */
  disabled,
  /** Whether the account is answering at all. */
  accountAnswering,
  onSave,
  /** Re-asks the account, the last resort once the dish has not answered. */
  onReload,
}: {
  reported: boolean | null;
  routerAnswering: boolean;
  dishPresence: RouterPresence;
  disabled: boolean;
  accountAnswering: boolean;
  onSave: (enabled: boolean) => Promise<void>;
  onReload: () => void;
}) {
  const { t } = useTranslation();
  // The value the open dialog is offering, captured when it opened. The account
  // can catch up while the dialog sits there, and reading the state fresh on
  // accept would send the opposite of the change the dialog named.
  const [offered, setOffered] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // What the last write asked for, outranking an account that keeps reporting the
  // old value for the minutes the router takes to go down or come back.
  const [assumed, setAssumed] = useState<boolean | null>(null);
  // Whether that assumption is still expecting confirmation.
  const [settling, setSettling] = useState(false);

  // Local proof first: the account lags a flip by minutes, and a router answering
  // on the LAN is one no bypass has silenced. One order serves both the display
  // and the wait below, so no signal can end the wait while a stronger one still
  // contradicts it.
  // `absent` is no evidence either way: a router that is off is not a bypassed one.
  const dishSays = dishPresence === "bypassed" ? true : dishPresence === "present" ? false : null;
  const known = (routerAnswering ? false : null) ?? dishSays ?? reported;
  const bypassed = assumed ?? known;
  // Off is the safe direction when the state is unknown, and a no-op if already off.
  const target = bypassed === null ? false : !bypassed;
  // What the control depicts. While a dialog is open it depicts what that dialog
  // offered, so nothing shifts underneath the question being asked.
  const shown = offered ?? target;

  // The account catching up arrives as a prop change, so the wait ends during
  // render rather than from an effect chasing it.
  // The note is cleared rather than replaced with a confirmation: once the state
  // has settled, the badge and the caption both say it, and a third sentence
  // saying it again is the only thing left to read.
  if (assumed !== null && known === assumed) {
    setAssumed(null);
    setSettling(false);
    setNote(null);
  }
  // Chained, because a state update in render does not change what this pass
  // already read: settling on the dish and losing the account in the same pass
  // would otherwise clear the note and then write this one over it.
  //
  // Nothing can confirm through an account this device can no longer reach, and
  // `assumed` outlives the wait so the row keeps offering the way back.
  else if (settling && assumed === true && !accountAnswering) {
    setSettling(false);
    setNote(t("bypass.sentUnconfirmable"));
  }

  useEffect(() => {
    if (!settling) return;
    const giveUp = setTimeout(() => {
      setAssumed(null);
      setSettling(false);
      setNote(t("bypass.couldNotConfirm"));
      // Asked once on the way out rather than polled throughout: the account is
      // the only thing left to ask, and it is the slowest of the three.
      onReload();
    }, SETTLE_TIMEOUT_MS);
    return () => clearTimeout(giveUp);
  }, [settling, onReload, t]);

  const caption = disabled
    ? // A router answering locally settles it: bypass is off, and this row is
      // behind the same account gate as the ones above it, nothing more. Only
      // when the router is silent can bypass be the reason, and then the way
      // back is what the caption has to name.
      bypassed === false
      ? t("advanced.connectAccountToUse")
      : t("bypass.connectInternetAndSignIn")
    : bypassed === null
      ? t("bypass.unknownState")
      : bypassed
        ? t("bypass.onCaption")
        : t("bypass.offCaption");

  const applyBypass = async (value: boolean) => {
    // Batched with the flag below, so the slider never sees both go false and
    // snap the handle back while the write is in flight.
    setOffered(null);
    setSaving(true);
    setError(null);
    setNote(null);
    try {
      await onSave(value);
      // Deliberately "sent", not "applied": a write that takes effect can kill
      // its own reply, and a reply that arrives cleanly is only ever ACCEPTED,
      // which the router also returns for changes it goes on to discard.
      setNote(value ? t("bypass.sentOn") : t("bypass.sentOff"));
      setAssumed(value);
      setSettling(true);
    } catch (saveError) {
      setError(errorText(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SettingRow
        title={t("bypass.title")}
        info={t("bypass.tip")}
        infoSeverity='danger'
        caption={caption}
        note={
          <>
            {note && (
              <span role='status' className='block'>
                {note}
              </span>
            )}
            {error && <span className='block text-destructive'>{error}</span>}
          </>
        }
      >
        {settling ? (
          <SpinLoader size={15} label={assumed ? t("bypass.turningOn") : t("bypass.turningOff")} />
        ) : (
          bypassed !== null && (
            <Badge tone={bypassed ? "critical" : "neutral"}>
              {bypassed ? t("common.on") : t("common.off")}
            </Badge>
          )
        )}
      </SettingRow>

      <div className='flex flex-col gap-2.5 pb-2'>
        <SlideToConfirm
          label={shown ? t("bypass.slideOn") : t("bypass.slideOff")}
          busyLabel={saving ? t("common.sending") : t("common.confirmContinue")}
          direction={shown ? "right" : "left"}
          tone={shown ? "danger" : "default"}
          // A flip is unresolved until the dish or the account says otherwise, and
          // the opposite write sent into that window races the one already out.
          disabled={disabled || settling}
          busy={offered !== null || saving}
          onConfirm={() => setOffered(target)}
        />
        {/* A tinted box is the app's colour for "something is broken"; this is a
            standing description of what the control does. The icon carries the
            weight instead, which is what it is separately severable for. */}
        <Callout tone='info' icon='warning' iconSeverity={bypassed === false ? "danger" : "normal"}>
          {bypassed === false
            ? t("bypass.explainOff")
            : bypassed
              ? t("bypass.explainOn")
              : t("bypass.explainUnknown")}
        </Callout>
      </div>

      <Dialog open={offered !== null} onOpenChange={(open) => !open && setOffered(null)}>
        <DialogContent
          showCloseButton={false}
          className='glass-panel gap-3 sm:max-w-md'
          overlayClassName='bg-black/30 backdrop-blur-[2px]'
        >
          <DialogHeader>
            <DialogTitle className='text-[19px] leading-snug'>{t("common.areYouSure")}</DialogTitle>
            <DialogDescription className='text-[13.5px] leading-relaxed'>
              {offered ? t("bypass.confirmOn") : t("bypass.confirmOff")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className='mt-2 gap-2'>
            <Button
              variant='outline'
              className='cursor-pointer sm:min-w-28'
              disabled={saving}
              onClick={() => setOffered(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant={offered ? "destructive" : "default"}
              className='cursor-pointer sm:min-w-28'
              disabled={saving}
              onClick={() => offered !== null && void applyBypass(offered)}
            >
              {saving ? t("common.sending") : offered ? t("bypass.turnOn") : t("bypass.turnOff")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
