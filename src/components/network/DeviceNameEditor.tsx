// Inline rename for a device: the pencil affordance beside the name, the edit
// row it opens, and the failure message the router's write lock produces.

import { useState } from "react";
import { GrpcWebError } from "../../lib/grpcWeb";
import type { WifiClientJson } from "../../lib/dishClient";
import { Input } from "@/components/ui/input";
import { actionButton } from "../ui/action-button";
import { PencilIcon } from "../../assets/icons/PencilIcon";
import { displayName } from "./networkFormat";

export function RenameButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className='inline-flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center rounded-[999px] border-none bg-[color-mix(in_srgb,var(--ink)_6%,var(--surface))] text-[var(--ink-secondary)] [transition:background_120ms_ease,color_120ms_ease] hover:bg-[color-mix(in_srgb,var(--ink)_12%,var(--surface))] hover:text-foreground'
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
  onRename: (macAddress: string, givenName: string) => Promise<void>;
  onDone: () => void;
}) {
  const [draftName, setDraftName] = useState(client.givenName ?? client.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commit = async () => {
    if (!client.macAddress || draftName.trim() === "" || draftName === displayName(client)) {
      onDone();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onRename(client.macAddress, draftName.trim());
      onDone();
    } catch (renameFailure) {
      // Status 7 = the firmware's LAN write lock (measured 2026-07: the router
      // refuses every rename shape from the LAN; only the official app's cloud
      // path can write). Anything else really is a transport problem.
      setError(
        renameFailure instanceof GrpcWebError && renameFailure.grpcStatus === 7
          ? "Starlink's current firmware blocks renames from the local network — rename this device in the official Starlink app instead."
          : "The router refused the rename.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className='mb-3.5 flex gap-2'>
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
        <button className={actionButton()} disabled={busy} onClick={() => void commit()}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button className={actionButton("subtle")} disabled={busy} onClick={onDone}>
          Cancel
        </button>
      </div>
      {error && <div className='py-2 text-[12.5px] leading-[1.5] text-destructive'>{error}</div>}
    </>
  );
}
