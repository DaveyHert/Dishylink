// Isolated harness for the window toolbar: renders it inside a stand-in macOS
// window so the traffic-light inset, the translucent bar and the sheet
// presentation can be judged together. It imports the real component and the
// app's stylesheet, so what shows here is what the app would get.
//
// The traffic lights and the window frame are drawn by this harness, not by the
// toolbar — under the desktop build they come from the OS, and under the
// extension there is no frame at all.
//
// Dev-server only, reached at /dev/toolbar-preview.html. Nothing in the app
// imports this file.

import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppToolbar, type SheetId } from "../src/components/shell/AppToolbar";
import "../src/index.css";

const SHEET_TITLE: Record<SheetId, string> = {
  speedtest: "Speed test",
  alignment: "Alignment",
  satellite: "Satellites",
  datausage: "Data usage",
  network: "Network",
  account: "Starlink account",
};

/** The three dots the OS paints over the toolbar's leading edge. */
function TrafficLights() {
  return (
    <div className='absolute top-[18px] left-[19px] z-30 flex gap-2'>
      <span className='size-[12px] rounded-full bg-[#ff5f57]' />
      <span className='size-[12px] rounded-full bg-[#febc2e]' />
      <span className='size-[12px] rounded-full bg-[#28c840]' />
    </div>
  );
}

function Window({ theme, compact = false }: { theme: "light" | "dark"; compact?: boolean }) {
  const [sheet, setSheet] = useState<SheetId | null>(null);

  return (
    <div
      data-theme={theme}
      className='relative isolate flex h-[560px] w-full flex-col overflow-hidden rounded-[10px] bg-[var(--page)] shadow-[0_22px_70px_rgba(0,0,0,0.45)]'
    >
      <TrafficLights />
      <AppToolbar
        onPresent={setSheet}
        connectionState='online'
        uptimeLabel='6d 4h'
        theme={theme}
        onToggleTheme={() => {}}
        onOpenSettings={() => {}}
        onOpenAlerts={() => {}}
        alertCount={2}
        trafficLightInset={78}
        compact={compact}
      />

      {/* Stand-in instrument, scrolling under the bar. */}
      <div className='min-h-0 flex-1 overflow-y-auto p-5'>
        <div className='grid grid-cols-6 gap-3'>
          {Array.from({ length: 6 }, (_, cell) => (
            <div
              key={cell}
              className='h-[84px] rounded-xl border border-solid border-[var(--hairline)] bg-[var(--surface)]'
            />
          ))}
        </div>
        <div className='mt-3 grid grid-cols-12 gap-3'>
          <div className='col-span-8 h-[300px] rounded-xl border border-solid border-[var(--hairline)] bg-[var(--surface)]' />
          <div className='col-span-4 h-[300px] rounded-xl border border-solid border-[var(--hairline)] bg-[var(--surface)]' />
        </div>
      </div>

      {/* A sheet: attached to the window, dropping from under the toolbar, over a
          dimmed instrument. Not a centred dialog floating on the page. */}
      {sheet && (
        <>
          <div
            className='absolute inset-0 z-10 bg-black/35'
            onClick={() => setSheet(null)}
            role='presentation'
          />
          <div className='absolute top-[52px] left-1/2 z-20 flex max-h-[76%] w-[76%] -translate-x-1/2 flex-col overflow-hidden rounded-b-[12px] border border-t-0 border-solid border-[var(--hairline)] bg-[var(--surface)] shadow-[0_26px_60px_rgba(0,0,0,0.5)] animate-[sheet-drop_260ms_cubic-bezier(0.32,0.72,0,1)_both]'>
            <div className='flex flex-none items-center justify-between border-b border-solid border-[var(--hairline)] px-5 py-3.5'>
              <span className='text-[15px] font-bold text-[var(--ink)]'>{SHEET_TITLE[sheet]}</span>
              <button
                onClick={() => setSheet(null)}
                className='cursor-pointer rounded-md border-0 bg-[color-mix(in_srgb,var(--ink)_9%,transparent)] px-3 py-1.5 text-[13px] font-semibold text-[var(--ink)]'
              >
                Done
              </button>
            </div>
            <div className='min-h-[220px] flex-1 p-5'>
              <div className='h-full rounded-lg border border-dashed border-input' />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Preview() {
  return (
    <div className='flex flex-col gap-9 bg-[#5f5f5f] p-9 font-sans'>
      <Window theme='dark' />
      <Window theme='light' />
      {/* Narrow window: labels drop, the bar stays one row. */}
      <div className='w-[560px]'>
        <Window theme='dark' compact />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
