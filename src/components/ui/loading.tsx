// A pending state: a spinner, optionally with a message saying what is pending.
//
// The message is passed by the caller, never inferred here — "contacting the router"
// and "waiting for obstruction data" are facts only the caller knows.
//
// Exact values enforced by loading.test.tsx.

import { SpinLoader, type SpinLoaderVariant } from "../loaders/SpinLoader";
import { cn } from "@/lib/utils";

interface LoadingProps {
  /** What is pending, e.g. "Contacting the router…". Omit for a bare spinner. */
  message?: string;
  /** Spinner diameter in px. Defaults to the inline size that suits a note row. */
  size?: number;
  /** NOTE: "orbit" is unusable here — it renders another product's logo mark. */
  variant?: Exclude<SpinLoaderVariant, "orbit">;
  /** Stack the spinner above the message — for a full-panel state rather than an
   *  inline note row. Default is the inline (side-by-side) layout. */
  stacked?: boolean;
  className?: string;
}

export function Loading({
  message,
  size = 16,
  variant = "conic",
  stacked = false,
  className,
}: LoadingProps) {
  return (
    <div
      data-slot='loading'
      className={cn(
        "flex items-center justify-center gap-2.5 py-[18px] text-[13px] font-medium text-muted-foreground",
        stacked && "flex-col gap-3 py-14",
        className,
      )}
    >
      <SpinLoader size={size} variant={variant} label={message ?? "Loading"} />
      {message && <span>{message}</span>}
    </div>
  );
}
