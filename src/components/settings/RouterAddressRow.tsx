// Where the app dials the router.
//
// This row has to keep working when the router does not answer, because a wrong
// address is the most likely reason it doesn't. Nothing here may sit behind a
// reachability check.

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SettingRow } from "./settingsChrome";
import { normalizeIpAddress } from "@core/ipAddress";
import {
  routerAddressHost,
  type RouterAddressWriteResult,
  type RouterAddress,
} from "../../lib/routerAddressHost";
import { addressSavable, saveArgument } from "./routerAddressDraft";

const REFUSAL_MESSAGE: Record<Extract<RouterAddressWriteResult, { ok: false }>["reason"], string> =
  {
    invalid: "That isn't an IP address this app can reach. Use the numeric address, not a name.",
    denied: "Permission to reach that address was declined, so it wasn't saved.",
    unsupported: "This browser can't be granted access to that address. Use an IPv4 address.",
  };

export function RouterAddressRow({
  addresses,
  onChanged,
}: {
  addresses: RouterAddress;
  onChanged: (next: RouterAddress) => void;
}) {
  const stored = addresses.router;
  const fallback = addresses.routerDefault;
  const [draft, setDraft] = useState(stored ?? "");
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<
    Extract<RouterAddressWriteResult, { ok: false }>["reason"] | null
  >(null);

  // The field follows what the host confirmed it stored, so a save that was
  // normalised on the way in shows the value actually in use.
  const [shownStored, setShownStored] = useState(stored);
  if (shownStored !== stored) {
    setShownStored(stored);
    setDraft(stored ?? "");
    setRefused(null);
  }

  const trimmed = draft.trim();

  const save = () => {
    const host = routerAddressHost();
    if (!host || !addressSavable(draft, stored)) return;
    setSaving(true);
    setRefused(null);
    void host
      .write(saveArgument(draft))
      .then((result) => {
        if (result.ok) onChanged(result.addresses);
        else setRefused(result.reason);
      })
      .finally(() => setSaving(false));
  };

  return (
    <>
      <SettingRow
        title='Router IP address'
        info={`Dishylink looks for your router at this address. Change it only if the router's subnet was moved in the Starlink app, or your kit is in bypass mode behind a third-party router. Clearing the box returns to ${fallback}.`}
        infoSeverity='warn'
        caption={`Default is ${fallback}`}
        note={
          refused ? (
            <span className='text-destructive'>{REFUSAL_MESSAGE[refused]}</span>
          ) : stored ? (
            `Dishylink is using ${stored}. Clear the box to go back to ${fallback}.`
          ) : undefined
        }
      >
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
          }}
          placeholder={fallback}
          spellCheck={false}
          autoComplete='off'
          inputMode='numeric'
          aria-label='Router IP address'
          aria-invalid={trimmed !== "" && normalizeIpAddress(trimmed) === null}
          className='h-8 w-[168px] font-mono text-[12px] tabular-nums'
        />
        <Button
          size='sm'
          variant='secondary'
          disabled={!addressSavable(draft, stored) || saving}
          onClick={save}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </SettingRow>
    </>
  );
}
