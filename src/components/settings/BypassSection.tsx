// Whether the Starlink router runs the network at all.
//
// The state comes from the account first, never from `wifiConfig`: a bypassed
// router serves no gRPC on the LAN, so the router is silent for the whole time
// the answer would be `true`. That silence is itself an answer in the other
// direction, which is the fallback here — a router answering locally is not
// bypassed, whatever the account's telemetry does or does not carry.
//
// The account is also what makes the way back reachable. The write rides the
// cloud gateway, which needs some internet rather than Starlink's in particular,
// so a kit with a third-party router wired in can be un-bypassed from the very
// machine that bypassed it. With nothing else serving internet that takes another
// device on mobile data, which is why an unreachable account says so plainly
// instead of only greying the control out.

import { useEffect, useState } from "react";
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
import { SettingRow } from "./settingsChrome";

const BYPASS_TIP =
  "Advanced feature that disables the Starlink router completely, so the dish serves a third-party router instead. The Starlink WiFi goes off and the client list, custom DNS and subnet stop working. Most users should leave this off.";

/** How long the account is given to report a write before the row stops waiting
 *  on it. Measured against hardware, the flip showed up around two minutes. */
const SETTLE_TIMEOUT_MS = 4 * 60_000;
const SETTLE_POLL_MS = 15_000;

export function BypassSection({
  /** What the account reports, or null when its telemetry carries no controller
   *  row to read it from. */
  reported,
  /** The router is answering on the LAN, which only an un-bypassed router does. */
  routerAnswering,
  /** No account connected, so the write has nowhere to go. */
  disabled,
  onSave,
  /** Re-asks the account, which is the only thing that can confirm a write. */
  onReload,
}: {
  reported: boolean | null;
  routerAnswering: boolean;
  disabled: boolean;
  onSave: (enabled: boolean) => Promise<void>;
  onReload: () => void;
}) {
  // The value the open dialog is offering, captured when it opened. The account
  // can catch up while the dialog sits there, and reading the state fresh on
  // accept would send the opposite of the change the dialog named.
  const [offered, setOffered] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // What the last write asked for. The row shows this in preference to what the
  // account says, because the account keeps reporting the old value for the
  // minutes the router takes to go down or come back — a row that waited for it
  // would spend that time insisting the change had not happened.
  const [awaiting, setAwaiting] = useState<boolean | null>(null);

  const bypassed = awaiting ?? reported ?? (routerAnswering ? false : null);
  // Null is not a state to write from: without knowing where it stands, the
  // control cannot say which way it would go.
  const target = bypassed === null ? null : !bypassed;
  // What the control depicts. While a dialog is open it depicts what that dialog
  // offered, so nothing shifts underneath the question being asked.
  const shown = offered ?? target;

  // The account catching up arrives as a prop change, so the wait ends during
  // render rather than from an effect chasing it.
  // The note is cleared rather than replaced with a confirmation: once the state
  // has settled, the badge and the caption both say it, and a third sentence
  // saying it again is the only thing left to read.
  if (awaiting !== null && reported === awaiting) {
    setAwaiting(null);
    setNote(null);
  }

  useEffect(() => {
    if (awaiting === null) return;
    const poll = setInterval(onReload, SETTLE_POLL_MS);
    // Assumed until the account contradicts it, but not forever: past this the
    // guess has outlived any lag it was covering, and the row goes back to
    // reporting what is actually known.
    const giveUp = setTimeout(() => {
      setAwaiting(null);
      setNote("Your account still reports the old state. Reopen this panel to check again.");
    }, SETTLE_TIMEOUT_MS);
    return () => {
      clearInterval(poll);
      clearTimeout(giveUp);
    };
  }, [awaiting, onReload]);

  const caption = disabled
    ? // A router answering locally settles it: bypass is off, and this row is
      // behind the same account gate as the ones above it, nothing more. Only
      // when the router is silent can bypass be the reason, and then the way
      // back is what the caption has to name.
      bypassed === false
      ? "Connect your Starlink account to use this"
      : "Connect this device to the internet and sign in your account to use"
    : bypassed === null
      ? "Couldn't tell whether the router is bypassed"
      : bypassed
        ? "The Starlink router is disabled; a third-party router runs the network"
        : "The Starlink router is running your network";

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
      // which the router also returns for changes it goes on to discard. The
      // account reporting the new value is the only thing that settles it, and
      // `awaiting` is what waits for that.
      setNote(
        value
          ? "Sent. The Starlink WiFi is going down; waiting for the account to confirm."
          : "Sent. The router is coming back up; waiting for the account to confirm.",
      );
      setAwaiting(value);
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SettingRow
        title='Bypass mode'
        info={BYPASS_TIP}
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
        {awaiting !== null ? (
          <SpinLoader size={15} label={awaiting ? "Turning bypass on" : "Turning bypass off"} />
        ) : (
          bypassed !== null && (
            <Badge tone={bypassed ? "critical" : "neutral"}>{bypassed ? "On" : "Off"}</Badge>
          )
        )}
      </SettingRow>

      <div className='flex flex-col gap-2.5 pb-2'>
        <SlideToConfirm
          label={shown ? "Slide to turn on bypass" : "Slide to turn off bypass"}
          busyLabel={saving ? "Sending…" : "Confirm to continue"}
          direction={shown ? "right" : "left"}
          tone={shown ? "danger" : "default"}
          disabled={disabled || target === null}
          busy={offered !== null || saving}
          onConfirm={() => setOffered(target)}
        />
        {target !== null && (
          // A tinted box is the app's colour for "something is broken"; this is a
          // standing description of what the control does. The icon carries the
          // weight instead, which is what it is separately severable for.
          <Callout tone='info' icon='warning' iconSeverity={target ? "danger" : "normal"}>
            {target
              ? "Bypass mode will completely disable the Starlink router and its WiFi. Only a third-party router wired to the dish stay online. You can turn it back off from here as long as this device is has access to the internet."
              : "Bypass is on, so the Starlink router is disabled and a third-party router runs your network. Turning bypass off brings the Starlink router and its WiFi back."}
          </Callout>
        )}
      </div>

      <Dialog open={offered !== null} onOpenChange={(open) => !open && setOffered(null)}>
        <DialogContent
          showCloseButton={false}
          className='glass-panel gap-3 sm:max-w-md'
          overlayClassName='bg-black/30 backdrop-blur-[2px]'
        >
          <DialogHeader>
            <DialogTitle className='text-[19px] leading-snug'>
              {offered ? "Turn on bypass mode?" : "Turn off bypass mode?"}
            </DialogTitle>
            <DialogDescription className='text-[13.5px] leading-relaxed'>
              {offered
                ? "The Starlink router and its WiFi will switch off. Only devices behind a third-party router wired to the dish stay online. You can turn bypass back off from here as long as this device still has internet — if nothing else provides it, you will need another device on mobile data."
                : "The Starlink router and its WiFi come back on. Devices connected through a third-party router may need to reconnect."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className='mt-2 gap-2'>
            <Button
              variant='outline'
              className='cursor-pointer sm:min-w-28'
              disabled={saving}
              onClick={() => setOffered(null)}
            >
              Cancel
            </Button>
            <Button
              variant={offered ? "destructive" : "default"}
              className='cursor-pointer sm:min-w-28'
              disabled={saving}
              onClick={() => offered !== null && void applyBypass(offered)}
            >
              {saving ? "Sending…" : offered ? "Turn on" : "Turn off"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
