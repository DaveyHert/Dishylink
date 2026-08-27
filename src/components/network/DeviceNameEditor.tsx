// Inline rename for a device: the pencil affordance beside the name, the edit
// row it opens, and the failure message the router's write lock produces.

import { useState } from "react";
import type { WifiClientJson } from "@core/dishClient";
import { Input } from "@/components/ui/input";
import { actionButton } from "../ui/action-button";
import { SpinLoader } from "../loaders/SpinLoader";
import { PencilIcon } from "../../assets/icons/PencilIcon";
import { displayName } from "./networkFormat";
import { AccountRequiredError } from "../../lib/routerClientUpdate";
import { AccountRequiredNotice } from "../shared/AccountRequiredNotice";

export function RenameButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className='inline-flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center rounded-[999px] border-none bg-[color-mix(in_srgb,var(--ink)_6%,var(--surface))] text-ink-secondary [transition:background_120ms_ease,color_120ms_ease] hover:bg-[color-mix(in_srgb,var(--ink)_12%,var(--surface))] hover:text-foreground'
      aria-label='Rename device'
      onClick={onClick}
    >
      <PencilIcon />
    </button>
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
  const [draftName, setDraftName] = useState(client.givenName ?? client.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const trimmedName = draftName.trim();
  // Blank or unchanged has nothing to write, so Save is not offered for either.
  const canSave =
    client.clientId !== undefined && trimmedName !== "" && trimmedName !== displayName(client);

  const commit = async () => {
    const { clientId } = client;
    if (!canSave || clientId === undefined) {
      onDone();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onRename(clientId, trimmedName);
      onDone();
    } catch (renameFailure) {
      setError(renameFailure as Error);
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
          placeholder='Device name'
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
