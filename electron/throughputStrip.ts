// The Windows counterpart to the macOS menu-bar throughput title.
//
// macOS writes the live ↓/↑ rate into the tray's title, beside the icon. Windows
// has no such title — a notification-area icon is a fixed square with no text
// beside it, and it's too narrow to spell out a rate with its unit. So on Windows
// the readout rides its own small frameless window docked over the taskbar, the
// same approach the taskbar network meters use now that Windows 11 has removed the
// deskband API those tools once relied on.
//
// Only the paint target differs from macOS. The data feed, staleness handling,
// preference, and watchdog all live in main.ts and drive both surfaces the same
// way — this module just turns two formatted strings into pixels on the taskbar.

import { BrowserWindow, screen } from "electron";
import { defaultStripPosition } from "./menuBarThroughput";

// Wide enough for the widest string the formatter can produce — "↑ 1000.0 Mb/s",
// the value just below each unit boundary — so the pill never clips (its text is
// nowrap). The pill hugs its content and right-aligns within this, so the spare
// width is just transparent margin, not a stretched box.
const STRIP_WIDTH = 140;
const STRIP_HEIGHT = 40;

// A translucent dark pill with light text, so the readout stays legible over a
// light or a dark taskbar without having to detect which. Self-contained: no
// external assets, so it loads straight from a data URL with nothing to bundle.
// The page exposes window.__setRates(down, up) as the one hook for updating the
// two lines from outside.
const PAGE = `<!doctype html>
<html>
<head><meta charset="utf-8"><style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: transparent;
    -webkit-user-select: none; cursor: default; }
  /* fit-content + auto left margin: the pill hugs its text and sits at the right
     edge, so a short reading never leaves a stretched box and the spare window
     width stays transparent. */
  .pill { box-sizing: border-box; height: 100%; width: fit-content; margin-left: auto;
    display: flex; flex-direction: column; justify-content: center; gap: 2px;
    padding: 3px 10px; border-radius: 9px;
    background: rgba(20, 22, 26, 0.72);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
    font: 600 12px/1.15 "Segoe UI", system-ui, sans-serif;
    font-variant-numeric: tabular-nums; color: #f2f4f8; }
  .row { display: flex; align-items: baseline; white-space: nowrap; }
  .arrow { width: 10px; font-weight: 700; }
  .dn .arrow { color: #5ac8fa; }
  .up .arrow { color: #a0e57f; }
  /* Push the value to the right edge so the digits line up column-for-column. */
  .val { margin-left: auto; }
</style></head>
<body>
  <div class="pill">
    <div class="row dn"><span class="arrow">&#8595;</span><span class="val" id="dn">&mdash;</span></div>
    <div class="row up"><span class="arrow">&#8593;</span><span class="val" id="up">&mdash;</span></div>
  </div>
  <script>
    window.__setRates = function (down, up) {
      document.getElementById("dn").textContent = down;
      document.getElementById("up").textContent = up;
    };
  </script>
</body>
</html>`;

let strip: BrowserWindow | null = null;
// The renderer runs __setRates, so paints before the page loads are held here and
// flushed once it's ready rather than dropped.
let ready = false;
let pending: { down: string; up: string } | null = null;

function positionStrip(): void {
  if (strip === null) return;
  const display = screen.getPrimaryDisplay();
  const { x, y } = defaultStripPosition(
    { bounds: display.bounds, workArea: display.workArea },
    { width: STRIP_WIDTH, height: STRIP_HEIGHT },
  );
  strip.setBounds({ x, y, width: STRIP_WIDTH, height: STRIP_HEIGHT });
}

/** Create the strip if it isn't up yet, and show it without taking focus. A
 *  no-op once it exists, so it's safe to call on every repaint. */
export function showThroughputStrip(): void {
  if (strip !== null) {
    // Wait for the first paint before showing, so a just-created window never
    // flashes its placeholder dashes; did-finish-load shows it once ready.
    if (ready && !strip.isVisible()) strip.showInactive();
    return;
  }
  strip = new BrowserWindow({
    width: STRIP_WIDTH,
    height: STRIP_HEIGHT,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // Not an app window: skipTaskbar keeps it off the taskbar and out of Alt+Tab.
    // (Deliberately not focusable:false — on Windows that combined with
    // transparent:true can leave the window blank, and setIgnoreMouseEvents below
    // already stops it stealing focus, so it buys nothing.)
    skipTaskbar: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // A readout, not a control: let every click fall through to the taskbar beneath,
  // so the strip can never swallow a Start-menu or tray click or take focus.
  strip.setIgnoreMouseEvents(true);
  // "screen-saver" is a high enough z-band to float above the taskbar, which is
  // itself topmost; a plain always-on-top window would render behind it.
  strip.setAlwaysOnTop(true, "screen-saver");
  strip.setVisibleOnAllWorkspaces(true);
  strip.on("closed", () => {
    strip = null;
    ready = false;
  });
  strip.webContents.once("did-finish-load", () => {
    ready = true;
    if (pending !== null) paintThroughputStrip(pending.down, pending.up);
    positionStrip();
    strip?.showInactive();
  });
  // Reposition when a monitor is added/removed or the taskbar moves or resizes.
  screen.on("display-metrics-changed", positionStrip);
  void strip.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(PAGE));
}

/** Update the two lines. Held until the page is ready, then applied. */
export function paintThroughputStrip(downLabel: string, upLabel: string): void {
  pending = { down: downLabel, up: upLabel };
  if (strip === null || !ready) return;
  void strip.webContents
    .executeJavaScript(`window.__setRates(${JSON.stringify(downLabel)}, ${JSON.stringify(upLabel)})`)
    .catch(() => {
      // The window may be tearing down between the guard and the call; the next
      // paint (or a fresh window) recovers, so a lost update isn't worth surfacing.
    });
}

/** Tear the strip down — the readout was switched off. */
export function hideThroughputStrip(): void {
  screen.removeListener("display-metrics-changed", positionStrip);
  if (strip !== null) {
    strip.destroy();
    strip = null;
  }
  ready = false;
  pending = null;
}
