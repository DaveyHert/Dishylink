// Which DNS servers the router forwards to.
//
// The write has no local path: current firmware answers a LAN set_config with
// PERMISSION_DENIED, so this goes through the account gateway or not at all. That
// is why the control is disabled without a connected account rather than failing
// at the moment someone presses Save.

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingRow } from "./settingsChrome";
import { normalizeIpAddress } from "@core/ipAddress";
import { MAX_NAMESERVERS } from "@core/routerConfigUpdate";
import { dnsFieldsValid, nameserversFrom } from "./customDnsFields";

const LABELS = ["Primary", "Backup", "Backup", "Backup"];
const PLACEHOLDERS = ["1.1.1.1", "1.0.0.1", "2606:4700:4700::1111", "2606:4700:4700::1001"];

export function CustomDnsSection({
  nameservers,
  disabled,
  onSave,
}: {
  /** What the router currently forwards to. Empty means Starlink's own. */
  nameservers: string[];
  /** No account connected, so the write has nowhere to go. */
  disabled: boolean;
  onSave: (nameservers: string[]) => Promise<void>;
}) {
  const [fields, setFields] = useState<string[]>(() =>
    Array.from({ length: MAX_NAMESERVERS }, (_, index) => nameservers[index] ?? ""),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(nameservers.length > 0);

  // Follow the router when it reports something different, so a change made in
  // the official app is not silently overwritten by a stale field.
  const [shown, setShown] = useState(nameservers.join(","));
  if (shown !== nameservers.join(",")) {
    setShown(nameservers.join(","));
    setFields(Array.from({ length: MAX_NAMESERVERS }, (_, index) => nameservers[index] ?? ""));
    setEnabled(nameservers.length > 0);
    setError(null);
  }

  const run = async (next: string[]) => {
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggle = (on: boolean) => {
    setEnabled(on);
    setError(null);
    // Turning it off is a complete instruction on its own, so it saves straight
    // away. Turning it on has nothing to send until an address is typed.
    if (!on && nameservers.length > 0) void run([]);
  };

  const changed = nameserversFrom(fields).join(",") !== nameservers.join(",");

  return (
    <>
      <SettingRow
        title='Custom DNS'
        info="Custom DNS lets you specify IPv4 or IPv6 addresses of one or more alternate DNS servers to be used for lookups instead of the Starlink defaults. A server that doesn't answer stops lookups for every device on the network."
        infoSeverity='warn'
        caption={
          disabled
            ? "Connect your Starlink account to use this"
            : "Send name lookups to your own servers instead of Starlink's"
        }
      >
        <Switch checked={enabled} disabled={disabled || saving} onCheckedChange={toggle} />
      </SettingRow>

      {enabled && (
        <div className='flex flex-col gap-2 pt-0.5 pb-2'>
          {fields.map((field, index) => (
            <div key={index} className='flex items-center justify-between gap-3'>
              <span className='text-[12px] text-muted-foreground'>{LABELS[index]}</span>
              <Input
                value={field}
                disabled={disabled || saving}
                onChange={(event) => {
                  const next = [...fields];
                  next[index] = event.target.value;
                  setFields(next);
                  setError(null);
                }}
                placeholder={PLACEHOLDERS[index]}
                spellCheck={false}
                autoComplete='off'
                aria-label={`${LABELS[index]} DNS server`}
                aria-invalid={field.trim() !== "" && normalizeIpAddress(field) === null}
                className='h-8 w-[232px] font-mono text-[12px] tabular-nums'
              />
            </div>
          ))}
          <div className='flex items-center justify-end gap-2'>
            {error && <span className='text-[12px] text-destructive'>{error}</span>}
            <Button
              size='sm'
              variant='secondary'
              disabled={disabled || saving || !changed || !dnsFieldsValid(fields)}
              onClick={() => void run(nameserversFrom(fields))}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
