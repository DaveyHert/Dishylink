// Which address range the router hands out.
//
// The passphrase field is not an extra safeguard, it is a requirement of the
// write: the router reports its stored passphrase as a row of dots and takes
// that string literally if it is sent back, so a subnet change that does not
// carry the real one locks every device off the WiFi. The official app puts the
// two on a single form for the same reason.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InfoDot } from "../shared/InfoDot";
import { ConnectorThread } from "../../assets/icons/ConnectorThread";
import { errorText } from "../../lib/errorText";
import { SettingRow } from "./settingsChrome";
import {
  MAX_PASSPHRASE,
  MIN_PASSPHRASE,
  SUBNET_PRESETS,
  subnetRefusal,
} from "@core/routerConfigUpdate";

export function SubnetSection({
  /** What the router reports today, so the current entry can be marked. */
  currentSubnet,
  /** No account connected, so the write has nowhere to go. */
  disabled,
  onSave,
}: {
  currentSubnet: string | null;
  disabled: boolean;
  onSave: (subnet: string, password: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  // Null while the router has not said where it is: a preset sitting in the
  // trigger reads as the range in use.
  const [subnet, setSubnet] = useState<string | null>(currentSubnet);
  const [password, setPassword] = useState("");
  // Shown by default: the whole risk here is a typo nobody can see, and the
  // official app shows it too.
  const [passwordVisible, setPasswordVisible] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNote, setSuccessNote] = useState<string | null>(null);
  const [editInProgress, setEditInProgress] = useState(false);

  // Follow the router when it reports a different subnet, so a change made in
  // the official app is not overwritten by a stale selection. Never mid-edit:
  // this form renders before the router has answered, so its first answer can
  // land while someone is part way through choosing.
  const [lastSeenSubnet, setLastSeenSubnet] = useState(currentSubnet);
  if (lastSeenSubnet !== currentSubnet) {
    setLastSeenSubnet(currentSubnet);
    if (!editInProgress) {
      setSubnet(currentSubnet);
      setConfirming(false);
    }
  }

  const subnetDiffersFromRouter = subnet !== null && subnet !== currentSubnet;
  const refusal = subnet === null ? null : subnetRefusal(subnet, password);
  const refusalMessage =
    refusal === null
      ? null
      : refusal === "unsupportedSubnet"
        ? t("subnet.refusedSubnet")
        : t("subnet.refusedPassword", { min: MIN_PASSPHRASE, max: MAX_PASSPHRASE });

  const applySubnet = async () => {
    if (subnet === null) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(subnet, password);
      setSuccessNote(t("subnet.moving", { subnet }));
      setConfirming(false);
      setPassword("");
      setEditInProgress(false);
    } catch (saveError) {
      setError(errorText(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SettingRow
        title={t("subnet.title")}
        info={t("subnet.tip")}
        infoSeverity='danger'
        caption={
          disabled
            ? t("advanced.connectAccountToUse")
            : currentSubnet === null && !successNote
              ? t("subnet.unknown")
              : t("subnet.caption")
        }
        note={
          successNote && (
            <span role='status' className='block'>
              {successNote}
            </span>
          )
        }
      >
        <Select
          value={subnet ?? undefined}
          disabled={disabled || saving}
          onValueChange={(next) => {
            setSubnet(next);
            setEditInProgress(true);
            setConfirming(false);
            setError(null);
            setSuccessNote(null);
          }}
        >
          <SelectTrigger size='sm' className='w-[168px] font-mono text-[12px] tabular-nums'>
            <SelectValue placeholder={t("subnet.notKnown")} />
          </SelectTrigger>
          <SelectContent>
            {SUBNET_PRESETS.map((preset) => (
              <SelectItem
                key={preset}
                value={preset}
                className='font-mono text-[12px] [&_[data-slot=select-item-indicator]]:hidden'
              >
                {preset}
                {preset === currentSubnet && (
                  <span className='ml-2 font-sans text-[11px] text-muted-foreground'>
                    {t("subnet.current")}
                  </span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      {subnetDiffersFromRouter && (
        <div className='flex flex-col gap-2 pt-0.5 pb-2'>
          <div className='relative flex items-center justify-between gap-5'>
            <ConnectorThread className='pointer-events-none absolute -top-[29px] right-[13px] h-[45px] w-2 animate-[rise_320ms_ease_both] text-ink/20' />
            <span className='flex items-center gap-1.5 text-[12px] text-muted-foreground'>
              {t("subnet.wifiPassword")}
              <InfoDot severity='danger' tip={t("subnet.passwordTip")} />
            </span>
            <div className='flex shrink-0 items-center gap-2'>
              <div className='relative'>
                <Input
                  type={passwordVisible ? "text" : "password"}
                  value={password}
                  disabled={disabled || saving}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setEditInProgress(true);
                    setError(null);
                  }}
                  placeholder={t("subnet.passwordPlaceholder")}
                  spellCheck={false}
                  autoComplete='off'
                  aria-label={t("subnet.wifiPassword")}
                  className='h-8 w-[232px] pr-8 text-[12px]'
                />
                <button
                  type='button'
                  aria-label={passwordVisible ? t("subnet.hidePassword") : t("subnet.showPassword")}
                  onClick={() => setPasswordVisible(!passwordVisible)}
                  className='absolute top-1/2 right-1 -translate-y-1/2 cursor-pointer rounded-sm border-0 bg-transparent p-1 text-muted-foreground transition-colors hover:text-foreground'
                >
                  {passwordVisible ? (
                    <EyeOffIcon className='size-3.5' />
                  ) : (
                    <EyeIcon className='size-3.5' />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className='flex items-center justify-end gap-2'>
            {error && <span className='text-[12px] text-destructive'>{error}</span>}
            {password !== "" && refusalMessage && (
              <span className='text-[12px] text-destructive'>{refusalMessage}</span>
            )}
            <Button
              size='sm'
              variant='secondary'
              disabled={disabled || saving || refusalMessage !== null}
              onClick={() => setConfirming(true)}
            >
              {saving ? t("subnet.movingEllipsis") : t("common.save")}
            </Button>
          </div>
        </div>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent
          showCloseButton={false}
          className='glass-panel gap-3 sm:max-w-md'
          overlayClassName='bg-black/30 backdrop-blur-[2px]'
        >
          <DialogHeader>
            <DialogTitle className='text-[19px] leading-snug'>
              {t("subnet.confirmTitle", { subnet })}
            </DialogTitle>
            <DialogDescription className='text-[13.5px] leading-relaxed'>
              {t("subnet.confirmBody")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className='mt-2 gap-2'>
            <Button
              variant='outline'
              className='cursor-pointer sm:min-w-28'
              disabled={saving}
              onClick={() => setConfirming(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant='destructive'
              className='cursor-pointer sm:min-w-28'
              disabled={saving}
              onClick={() => void applySubnet()}
            >
              {saving ? t("subnet.movingEllipsis") : t("subnet.move")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
