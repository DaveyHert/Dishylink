// One editable address for a LAN box, shared by the router and dish rows.
//
// The two rows differ only in their words and in where the value is written, so
// the draft state, the save-in-flight handling, and the refusal lines live here
// once. This row has to keep working when the box does not answer, because a
// wrong address is the most likely reason it doesn't: nothing here may sit
// behind a reachability check.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { TranslationKey } from "@core/i18n/resources";
import { SettingRow } from "./settingsChrome";
import { normalizeIpAddress } from "@core/ipAddress";
import { addressSavable, saveArgument } from "./routerAddressDraft";

export type AddressRefusal = "invalid" | "denied" | "unsupported";

export type AddressSaveResult = { ok: true } | { ok: false; reason: AddressRefusal };

export interface AddressRowCopy {
  title: TranslationKey;
  tip: TranslationKey;
  defaultIs: TranslationKey;
  using: TranslationKey;
  refused: Record<AddressRefusal, TranslationKey>;
}

export function AddressRow({
  stored,
  fallback,
  copy,
  save,
}: {
  stored: string | null;
  fallback: string;
  copy: AddressRowCopy;
  /** Null clears the setting back to the default. */
  save: (address: string | null) => Promise<AddressSaveResult>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(stored ?? "");
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<AddressRefusal | null>(null);

  // The field follows what the host confirmed it stored, so a save that was
  // normalised on the way in shows the value actually in use.
  const [shownStored, setShownStored] = useState(stored);
  if (shownStored !== stored) {
    setShownStored(stored);
    setDraft(stored ?? "");
    setRefused(null);
  }

  const trimmed = draft.trim();

  const commit = () => {
    if (!addressSavable(draft, stored)) return;
    setSaving(true);
    setRefused(null);
    void save(saveArgument(draft))
      .then((result) => {
        if (!result.ok) setRefused(result.reason);
      })
      .finally(() => setSaving(false));
  };

  return (
    <>
      <SettingRow
        title={t(copy.title)}
        info={t(copy.tip, { fallback })}
        infoSeverity='warn'
        caption={t(copy.defaultIs, { fallback })}
        note={
          refused ? (
            <span className='text-destructive'>{t(copy.refused[refused])}</span>
          ) : stored ? (
            t(copy.using, { stored, fallback })
          ) : undefined
        }
      >
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
          placeholder={fallback}
          spellCheck={false}
          autoComplete='off'
          inputMode='numeric'
          aria-label={t(copy.title)}
          aria-invalid={trimmed !== "" && normalizeIpAddress(trimmed) === null}
          className='h-8 w-[168px] font-mono text-[12px] tabular-nums'
        />
        <Button
          size='sm'
          variant='secondary'
          disabled={!addressSavable(draft, stored) || saving}
          onClick={commit}
        >
          {saving ? t("common.savingEllipsis") : t("common.save")}
        </Button>
      </SettingRow>
    </>
  );
}
