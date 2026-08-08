// One-of-N selector with two looks:
//  - "toggle" (default): the compact mono pill — chart windows, energy/data ranges,
//    stat detail. Active item is an ink slab.
//  - "glider": the larger tab switch with a glider that slides to the active item —
//    the Settings modal (Starlink/Router) and Network panel (Devices/Nodes). Track,
//    glider and label colors invert by theme.
//
// Radix ToggleGroup gives roving tabindex and arrow-key navigation. Exact values
// for the toggle look are enforced by segmented-control.test.tsx.

import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  label: ReactNode;
  value: T;
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group, e.g. "Chart time window". */
  label: string;
  variant?: "toggle" | "glider";
  /** Locks the whole control (e.g. while a speed test is running). */
  disabled?: boolean;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  variant = "toggle",
  disabled,
  className,
}: SegmentedControlProps<T>) {
  // ToggleGroup allows deselecting the active item, which would leave the control
  // with no selection — impossible here. Ignore the empty value.
  const commonRootProps = {
    type: "single" as const,
    value,
    onValueChange: (next: string) => next && onChange(next as T),
    disabled,
    "aria-label": label,
    "data-slot": "segmented-control",
  };

  if (variant === "glider") {
    // A 13px pill switch with a glider that slides to the active tab. Light =
    // ink slab / page text; dark inverts to a raised surface pill / ink text
    // (not a white slab), so those need `dark:`.
    //
    // Sized for any column count: the track pads 3px on every side, leaving
    // `100% - 6px` split into N equal columns, so a glider that wide (and moved a
    // whole column-width per index) lands exactly on each tab. Grid template and
    // glider geometry go inline because the counts are runtime values Tailwind's
    // JIT can't see.
    const activeIndex = options.findIndex((option) => option.value === value);
    return (
      <ToggleGroupPrimitive.Root
        {...commonRootProps}
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
        className={cn(
          "relative mx-auto grid w-fit rounded-[999px] p-[3px]",
          "bg-[color-mix(in_srgb,var(--ink)_7%,var(--surface))] dark:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)]",
          className,
        )}
      >
        <span
          aria-hidden='true'
          style={{
            width: `calc((100% - 6px) / ${options.length})`,
            // Clamp: an unmatched value indexes to -1, which would slide the glider
            // a full column off the left of the pill; fall back to the first tab.
            transform: `translateX(${Math.max(0, activeIndex) * 100}%)`,
          }}
          className={cn(
            "pointer-events-none absolute inset-y-[3px] left-[3px] rounded-[999px] bg-ink",
            "transition-transform duration-220 ease-in-out",
            "dark:dark:bg-card dark:shadow-[0_1px_2px_rgba(0,0,0,0.15)]",
          )}
        />
        {options.map((option) => (
          <ToggleGroupPrimitive.Item
            key={option.value}
            value={option.value}
            data-slot='segmented-control-item'
            className={cn(
              "relative z-1 cursor-pointer border-0 bg-transparent px-6 py-[7px] text-center font-sans text-[13px] font-semibold transition-colors duration-200 disabled:cursor-default disabled:opacity-50",
              option.value === value
                ? "text-page dark:text-foreground"
                : "text-ink-secondary dark:text-muted-foreground",
            )}
          >
            {option.label}
          </ToggleGroupPrimitive.Item>
        ))}
      </ToggleGroupPrimitive.Root>
    );
  }

  return (
    <ToggleGroupPrimitive.Root
      {...commonRootProps}
      className={cn(
        "inline-flex overflow-hidden rounded-[999px] bg-[color-mix(in_srgb,var(--ink)_6%,var(--surface))]",
        className,
      )}
    >
      {options.map((option) => (
        <ToggleGroupPrimitive.Item
          key={option.value}
          value={option.value}
          data-slot='segmented-control-item'
          className='cursor-pointer border-0 bg-transparent px-[13px] py-[5px] font-mono text-[10.5px] tracking-[0.06em] text-muted-foreground [transition:color_120ms_ease,background_120ms_ease] hover:text-foreground data-[state=on]:bg-primary data-[state=on]:font-semibold data-[state=on]:text-primary-foreground'
        >
          {option.label}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}
