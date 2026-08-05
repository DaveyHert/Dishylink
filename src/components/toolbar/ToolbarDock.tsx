import { useRef, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";
import { cn } from "@/lib/utils";
import type { ToolbarItem, ToolbarItemId } from "./AppToolbar";

interface ToolbarDockProps {
  items: ToolbarItem[];
  activeId: string | null;
  onSelect: (id: ToolbarItemId) => void;
}

// Peak scale under the cursor and the reach over which neighbours taper back to
// rest — a ~110px falloff lifts the two tiles either side.
const PEAK = 1.4;
const REACH = 110;
const spring = { stiffness: 340, damping: 22, mass: 0.4 };
const DOT = 5;

function DockTile({
  item,
  active,
  index,
  pointerX,
  onSelect,
  onEnter,
  registerRef,
}: {
  item: ToolbarItem;
  active: boolean;
  index: number;
  pointerX: MotionValue<number>;
  onSelect: (id: ToolbarItemId) => void;
  onEnter: (index: number) => void;
  registerRef: (index: number, el: HTMLButtonElement | null) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);

  // Distance from the pointer to this tile's centre, in viewport pixels.
  const distance = useTransform(pointerX, (x) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return REACH * 4;
    return x - (box.left + box.width / 2);
  });
  const scale = useSpring(
    useTransform(distance, [-REACH, 0, REACH], [1, PEAK, 1], { clamp: true }),
    spring,
  );
  const y = useTransform(scale, (value) => -(value - 1) * 6);

  return (
    <button
      ref={(el) => {
        ref.current = el;
        registerRef(index, el);
      }}
      type='button'
      onClick={() => onSelect(item.id)}
      onMouseEnter={() => onEnter(index)}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      className='group relative flex h-[34px] w-[46px] flex-none cursor-pointer items-end justify-center border-0 bg-transparent'
    >
      {/* The label floats clear above the icon that lifts under the pointer. */}
      <span className='pointer-events-none absolute bottom-[calc(100%+20px)] left-1/2 -translate-x-1/2 translate-y-1 rounded-[8px] border border-[color-mix(in_srgb,var(--ink)_12%,transparent)] bg-popover px-2.5 py-1 text-[11.5px] font-semibold whitespace-nowrap text-popover-foreground opacity-0 shadow-[0_10px_28px_rgba(0,0,0,0.45)] transition-[opacity,transform] duration-150 group-hover:translate-y-0 group-hover:opacity-100'>
        {item.label}
      </span>
      <motion.span
        style={{ scale, y }}
        className={cn(
          "flex size-[34px] origin-bottom items-center justify-center rounded-[11px] text-ink-secondary transition-colors group-hover:text-foreground",
          active && "text-foreground",
        )}
      >
        <item.Icon size={23} className='flex-none' />
      </motion.span>
    </button>
  );
}

export function ToolbarDock({ items, activeId, onSelect }: ToolbarDockProps) {
  // Infinity parks every tile at rest scale until the pointer is over the dock.
  const pointerX = useMotionValue(Number.POSITIVE_INFINITY);

  // The travelling bead: `targetX` is where it should sit (the hovered tile's
  // centre) and `dotX` springs toward it, so moving between tiles reads as one
  // fluid slide. `visible` scales it in on entry and out on exit.
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const hoveredRef = useRef<number | null>(null);
  const targetX = useMotionValue(0);
  const dotX = useSpring(targetX, { stiffness: 520, damping: 34, mass: 0.5 });
  const [visible, setVisible] = useState(false);

  const enterTile = (index: number) => {
    const tile = tileRefs.current[index];
    if (!tile) return;
    const centre = tile.offsetLeft + tile.offsetWidth / 2 - DOT / 2;
    targetX.set(centre);
    // First tile entered: drop the bead straight in so it scales up in place
    // rather than sliding across from the pill's left edge.
    if (hoveredRef.current === null) dotX.jump(centre);
    hoveredRef.current = index;
    setVisible(true);
  };

  const leave = () => {
    hoveredRef.current = null;
    setVisible(false);
    pointerX.set(Number.POSITIVE_INFINITY);
  };

  return (
    <div className='fixed bottom-[25px] left-1/2 z-30 -translate-x-1/2'>
      <motion.nav
        aria-label='Dashboard sections'
        initial={{ opacity: 0, y: 26 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 26 }}
        transition={{ type: "spring", stiffness: 360, damping: 30 }}
        onMouseMove={(event) => pointerX.set(event.clientX)}
        onMouseLeave={leave}
        className='relative flex items-end gap-2 rounded-full border border-[color-mix(in_srgb,var(--ink)_12%,transparent)] bg-[color-mix(in_srgb,var(--surface-raised)_16%,transparent)] px-3.5 pt-2.5 pb-2.5 shadow-[0_4px_14px_rgba(0,0,0,0.20),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-[7px] transition-[background-color,backdrop-filter] duration-200 hover:bg-[color-mix(in_srgb,var(--surface-raised)_80%,transparent)] hover:backdrop-blur-[26px] hover:backdrop-saturate-[150%]'
      >
        {items.map((item, index) => (
          <DockTile
            key={item.id}
            item={item}
            index={index}
            active={activeId === item.id}
            pointerX={pointerX}
            onSelect={onSelect}
            onEnter={enterTile}
            registerRef={(i, el) => {
              tileRefs.current[i] = el;
            }}
          />
        ))}
        <motion.span
          aria-hidden
          style={{ x: dotX }}
          animate={{ scale: visible ? 1 : 0, opacity: visible ? 1 : 0 }}
          transition={{
            scale: { type: "spring", stiffness: 500, damping: 26 },
            opacity: { duration: 0.15 },
          }}
          className='pointer-events-none absolute bottom-[6px] left-0 size-[5px] rounded-full bg-foreground'
        />
      </motion.nav>
    </div>
  );
}
