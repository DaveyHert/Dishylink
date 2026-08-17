// The offer to read the device roster through the Starlink account while the LAN
// cannot answer. Only the roster is asked for: the router's config is read from
// the account on its own, so the settings that show it never go dark waiting for
// a click here.

import { Button } from "../ui/button";
import { SpinLoader } from "../loaders/SpinLoader";

export function AccountRosterOffer({
  status,
  error,
  onConnect,
}: {
  status: "idle" | "loading" | "failed";
  error: string | null;
  onConnect: () => void;
}) {
  return (
    <div className='mt-3.5 flex flex-col items-center gap-1.5'>
      <Button
        className='min-w-[13rem] cursor-pointer rounded-full px-5 disabled:opacity-100'
        disabled={status === "loading"}
        onClick={onConnect}
      >
        {status === "loading" ? (
          <>
            <SpinLoader variant='segment' size={16} label='Connecting' />
            Connecting…
          </>
        ) : (
          "Connect through Cloud"
        )}
      </Button>
      <span
        className={error ? "text-[11.5px] text-destructive" : "text-[11.5px] text-muted-foreground"}
      >
        {error ?? "Your devices, read from your Starlink account until the router answers again."}
      </span>
    </div>
  );
}
