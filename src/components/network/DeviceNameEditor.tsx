// Inline rename: the pencil affordance beside a name, the edit row it opens, and
// the failure message the router's write lock produces. Used for both a client
// device and a mesh node — the two differ only in what a saved name is keyed by.

import { useState } from "react";
import type { WifiClientJson } from "@core/dishClient";
import { Input } from "@/components/ui/input";
import { actionButton } from "../ui/action-button";
import { SpinLoader } from "../loaders/SpinLoader";
import { PencilIcon } from "../../assets/icons/PencilIcon";
import { displayName } from "./networkFormat";
import { AccountRequiredError } from "../../lib/routerClientUpdate";
import { AccountRequiredNotice } from "../shared/AccountRequiredNotice";

export function RenameButton({
  onClick,
  label = "Rename device",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      className='inline-flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center rounded-[999px] border-none bg-[color-mix(in_srgb,var(--ink)_6%,var(--surface))] text-ink-secondary [transition:background_120ms_ease,color_120ms_ease] hover:bg-[color-mix(in_srgb,var(--ink)_12%,var(--surface))] hover:text-foreground'
      aria-label={label}
      onClick={onClick}
    >
      <PencilIcon />
    </button>
  );
}

function NameEditorForm({
  currentName,
  initialName = currentName,
  placeholder,
  extraValid = true,
  onSave,
  onDone,
}: {
  /** The name a save is compared against, so an unchanged value is a no-op. */
  currentName: string;
  /** What the field starts with, when that is not the same string — a device
   *  known only by address seeds blank but still counts address as unchanged. */
  initialName?: string;
  placeholder: string;
  /** A further condition on saving beyond "non-empty and changed" — a client
   *  with no id cannot be renamed, for one. */
  extraValid?: boolean;
  onSave: (name: string) => Promise<void>;
  onDone: () => void;
}) {
  const [draftName, setDraftName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const trimmedName = draftName.trim();
  const canSave = extraValid && trimmedName !== "" && trimmedName !== currentName;

  const commit = async () => {
    if (!canSave) {
      onDone();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(trimmedName);
      onDone();
    } catch (saveFailure) {
      setError(saveFailure as Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={`flex gap-2 ${error ? "mb-1.5" : "mb-3.5"}`}>
        <Input
          className='h-8 text-sm'
          autoFocus
          value={draftName}
          disabled={busy}
          placeholder={placeholder}
          onChange={(event) => {
            setDraftName(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void commit();
            if (event.key === "Escape") onDone();
          }}
        />
        <button
          className={`${actionButton()} inline-flex min-w-[4.5rem] items-center justify-center ${
            busy ? "disabled:opacity-100" : ""
          }`}
          disabled={busy || !canSave}
          onClick={() => void commit()}
        >
          {busy ? <SpinLoader variant='segment' size={16} label='Saving' /> : "Save"}
        </button>
        <button className={actionButton("subtle")} disabled={busy} onClick={onDone}>
          Cancel
        </button>
      </div>
      {error && (
        <div className='pb-3.5 text-[12.5px] leading-[1.5] text-destructive'>
          {error instanceof AccountRequiredError ? <AccountRequiredNotice /> : error.message}
        </div>
      )}
    </>
  );
}

export function DeviceNameEditor({
  client,
  onRename,
  onDone,
}: {
  client: WifiClientJson;
  onRename: (clientId: number, givenName: string) => Promise<void>;
  onDone: () => void;
}) {
  return (
    <NameEditorForm
      currentName={displayName(client)}
      initialName={client.givenName ?? client.name ?? ""}
      placeholder='Device name'
      extraValid={client.clientId !== undefined}
      onSave={(name) => onRename(client.clientId as number, name)}
      onDone={onDone}
    />
  );
}

export function MeshNodeNameEditor({
  deviceId,
  currentName,
  onRename,
  onDone,
}: {
  deviceId: string;
  /** The stored `meshConfigs` display name — the field this writes, not the
   *  roster label, which can fall back to a hostname. */
  currentName: string;
  onRename: (deviceId: string, displayName: string) => Promise<void>;
  onDone: () => void;
}) {
  return (
    <NameEditorForm
      currentName={currentName}
      placeholder='Node name'
      onSave={(name) => onRename(deviceId, name)}
      onDone={onDone}
    />
  );
}
