// The left rail: a glass capsule floating off the left edge.
import { useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import type { ToolbarItem, ToolbarItemId } from "./AppToolbar";

interface ToolbarRailProps {
  items: ToolbarItem[];
  activeId: string | null;
  onSelect: (id: ToolbarItemId) => void;
}

const COLLAPSED = 64;
const OPEN = 214;
const spring = { type: "spring" as const, stiffness: 420, damping: 34 };

export function ToolbarRail({ items, activeId, onSelect }: ToolbarRailProps) {
  const [open, setOpen] = useState(false);

  return (
    <motion.nav
      aria-label='Dashboard sections'
      onHoverStart={() => setOpen(true)}
      onHoverEnd={() => setOpen(false)}
      initial={{ opacity: 0, x: -16, y: "-50%" }}
      animate={{ opacity: 1, x: 0, y: "-50%", width: open ? OPEN : COLLAPSED }}
      exit={{ opacity: 0, x: -16, y: "-50%" }}
      transition={spring}
      className='fixed top-1/2 left-[12px] z-30 flex flex-col gap-1 overflow-hidden rounded-[26px] border border-[color-mix(in_srgb,var(--ink)_12%,transparent)] max-[950px]:left-[6px] bg-[color-mix(in_srgb,var(--surface-raised)_16%,transparent)] p-2.5 shadow-[0_4px_14px_rgba(0,0,0,0.20),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-[7px] transition-[background-color,backdrop-filter] duration-200 hover:bg-[color-mix(in_srgb,var(--surface-raised)_80%,transparent)] hover:backdrop-blur-[24px] hover:backdrop-saturate-[150%]'
    >
      {items.map((item) => {
        const active = activeId === item.id;
        return (
          <button
            key={item.id}
            type='button'
            onClick={() => onSelect(item.id)}
            aria-label={item.label}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex h-11 flex-none cursor-pointer items-center gap-3.5 rounded-full border-0 bg-transparent px-[11px] text-ink-secondary transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-foreground",
              active && "bg-[color-mix(in_srgb,var(--ink)_10%,transparent)] text-foreground",
            )}
          >
            <item.Icon size={21} className='flex-none' />
            <motion.span
              aria-hidden={!open}
              animate={{ opacity: open ? 1 : 0, x: open ? 0 : -4 }}
              transition={{ duration: 0.18 }}
              className='text-[13.5px] font-medium whitespace-nowrap'
            >
              {item.label}
            </motion.span>
          </button>
        );
      })}
    </motion.nav>
  );
}
