// The round glass controls that float over a sky scene.
//
// Shared by both surfaces that draw a dome — the dashboard card and the full sky
// view — so the same setting cannot end up wearing two slightly different
// buttons. Sized like the modal close button elsewhere.

import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

const roundControl =
  "inline-flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-full " +
  "border border-[#8b97a82e] bg-[#0a0e16b8] text-[13px] text-[#8b97a8] backdrop-blur-sm hover:text-[#c7d0dc]";

/** One of the round controls over the sky. The label is both the tooltip and the
 *  accessible name, so the two can never drift apart; `pressed` marks the ones
 *  that are a state rather than an action. */
export function SkyControl({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type='button'
          aria-label={label}
          aria-pressed={pressed}
          className={roundControl}
          onClick={onClick}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side='bottom'>{label}</TooltipContent>
    </Tooltip>
  );
}
