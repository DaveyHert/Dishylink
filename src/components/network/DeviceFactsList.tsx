// The device spec sheet, collapsed by default.
//
// The facts list runs ~17 rows; past a handful it is capped to a scroll box so
// the Throughput charts below stay on screen, and "View full details" drops the
// cap and spreads every row out. A short list needs neither and renders plain.

import { useState } from "react";
import { motion } from "motion/react";
import { DataRow } from "./DataRow";
import type { DeviceFact } from "./deviceFacts";

const SCROLLABLE_AFTER_ROWS = 8;
const COLLAPSED_PX = 280;

export function DeviceFactsList({ facts }: { facts: DeviceFact[] }) {
  const [expanded, setExpanded] = useState(false);

  const rows = facts.map((fact) => (
    <DataRow key={fact.key} label={fact.label} value={fact.value} />
  ));

  if (facts.length <= SCROLLABLE_AFTER_ROWS) {
    return <div className='flex flex-col'>{rows}</div>;
  }

  return (
    <>
      <motion.div
        initial={false}
        animate={{ height: expanded ? "auto" : COLLAPSED_PX }}
        transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
        className={`flex flex-col ${expanded ? "overflow-hidden" : "thin-scroll overflow-y-auto"}`}
      >
        {rows}
      </motion.div>
      <button
        className='flex w-full cursor-pointer items-center justify-center gap-1 border-0 bg-transparent py-2.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground'
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
      >
        {expanded ? "Collapse" : "View full details"}
        <span
          className={`text-[14px] leading-none transition-transform ${expanded ? "-rotate-90" : "rotate-90"}`}
          aria-hidden='true'
        >
          ›
        </span>
      </button>
    </>
  );
}
