// Empty-first-run state: shown when the app has never heard from the dish.
// A sweeping radar dial over instructions for reaching the terminal directly.

import { DISH_LAN_ADDRESS } from "@core/dishClient";

export function SearchingHero() {
  return (
    <div className='flex min-h-[60vh] flex-col items-center justify-center gap-3.5 p-6 text-center'>
      <div className='relative size-[74px] overflow-hidden rounded-full border border-input'>
        {/* inner ring */}
        <div className='absolute inset-[18px] rounded-full border border-input' />
        {/* the rotating sweep */}
        <div className='absolute inset-0 animate-[sweep_2.6s_linear_infinite] [background:conic-gradient(from_0deg,transparent_78%,color-mix(in_srgb,var(--ink)_45%,transparent))]' />
      </div>
      <div className='text-[19px] font-bold tracking-[0.18em]'>SEARCHING FOR DISH</div>
      <p className='max-w-[420px] text-[13.5px] text-ink-secondary'>
        Dishylink talks to your Starlink terminal directly at{" "}
        <code className='rounded-[5px] dark:bg-card px-1.5 py-px font-mono text-[12px]'>
          {DISH_LAN_ADDRESS}
        </code>
        . Make sure this machine is connected to the Starlink network (Wi‑Fi or ethernet behind the
        Starlink router) and that the dish is powered. Retrying automatically…
      </p>
    </div>
  );
}
