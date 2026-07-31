// The round glass controls that float over a sky scene.
//
// Shared by both surfaces that draw a dome — the dashboard card and the full sky
// view — so the same setting cannot end up wearing two slightly different
// buttons. Sized like the modal close button elsewhere.

import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

const roundControl =
  "inline-flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-full " +
  "border border-[#8b97a82e] bg-[#000] text-[13px] text-[#8b97a8] backdrop-blur-sm hover:text-[#c7d0dc] " +
  "aria-pressed:border-[#c7d0dc59] aria-pressed:bg-[#161f2ecc] aria-pressed:text-[#e6ebf2]";

/** One of the round controls over the sky. The label is both the tooltip and the
 *  accessible name, so the two can never drift apart; `pressed` marks a control
 *  that holds a state rather than firing an action, and lights it while on. */
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
