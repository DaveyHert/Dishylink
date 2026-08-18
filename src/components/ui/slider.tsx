import * as React from "react";
import { Slider as SliderPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

// Dishylink slider: a hairline track with a hollow thumb, so a value sitting
// near either end still reads against the track rather than swallowing it.
function Slider({ className, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot='slider'
      className={cn(
        "relative flex w-full cursor-pointer touch-none items-center select-none",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot='slider-track'
        className='relative h-1 w-full grow rounded-full bg-[color-mix(in_srgb,var(--ink)_12%,transparent)]'
      >
        <SliderPrimitive.Range
          data-slot='slider-range'
          className='absolute h-full rounded-full bg-[color-mix(in_srgb,var(--ink)_45%,var(--baseline))]'
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot='slider-thumb'
        className={cn(
          "block size-4 rounded-full border-2 border-primary bg-card shadow-sm transition-[box-shadow]",
          "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        )}
      />
    </SliderPrimitive.Root>
  );
}

export { Slider };
