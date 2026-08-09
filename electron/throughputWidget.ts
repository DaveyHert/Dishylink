// Windows throughput widget — a frameless, always-on-top, draggable pill that
// shows live ↓/↑ rates. Position is persisted between runs and clamped to the
// visible desktop. Data feed and preferences live in main.ts.

import { app, BrowserWindow, screen } from "electron";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

// Pill styling.
const PILL_PADDING_Y = 5;
const PILL_PADDING_X = 9;
const FONT_SIZE = 11;
// Initial window size before the first paint snaps it to the pill.
const WIDGET_WIDTH = 200;
const WIDGET_HEIGHT = 30;
const DEFAULT_MARGIN = 16;
const SAVE_DEBOUNCE_MS = 300;

const PAGE = `<!doctype html>
<html>
<head><meta charset="utf-8"><style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: transparent;
    -webkit-user-select: none; cursor: default; }
  .pill { -webkit-app-region: drag; display: flex; width: fit-content; align-items: center;
    gap: 10px; padding: ${PILL_PADDING_Y}px ${PILL_PADDING_X}px; border-radius: 6px;
    background: rgba(20, 22, 26, 0.88);
    font: 600 ${FONT_SIZE}px/1 "Segoe UI", system-ui, sans-serif;
    font-variant-numeric: tabular-nums; color: #ffffff; }
  .item { display: flex; align-items: center; gap: 4px; white-space: nowrap; }
  .arrow-down { color: #5ac8fa; }
  .arrow-up { color: #a0e57f; }
</style></head>
<body>
  <div class="pill">
    <div class="item"><span class="arrow-down">&#8595;</span><span id="downVal">&mdash;</span></div>
    <div class="item"><span class="arrow-up">&#8593;</span><span id="upVal">&mdash;</span></div>
  </div>
  <script>
    window.__setRates = function (down, up) {
      document.getElementById("downVal").textContent = down;
      document.getElementById("upVal").textContent = up;
      var r = document.querySelector(".pill").getBoundingClientRect();
      return { w: Math.ceil(r.width), h: Math.ceil(r.height) };
    };
  </script>
</body>
</html>`;

let widget: BrowserWindow | null = null;
let ready = false;
let pending: { down: string; up: string } | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
// Track drag state so we can defer resizing while the user is actively dragging.
let isDragging = false;
let pendingSize: { w: number; h: number } | null = null;
// Guards clampToScreen's setBounds from re-entering the "moved" handler.
let clamping = false;

function positionFile(): string {
  return join(app.getPath("userData"), "throughput-widget-position.json");
}

function loadPosition(): { x: number; y: number } | null {
  try {
    const parsed = JSON.parse(readFileSync(positionFile(), "utf8")) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { x: unknown }).x === "number" &&
      typeof (parsed as { y: unknown }).y === "number"
    ) {
      return { x: (parsed as { x: number }).x, y: (parsed as { y: number }).y };
    }
  } catch {
    // No file yet or unreadable.
  }
  return null;
}

/** Debounced: clamp to screen then persist position after drag settles. */
function savePositionDebounced(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    isDragging = false;
    if (widget === null || widget.isDestroyed()) return;

    // Apply any resizes that were deferred while dragging.
    if (pendingSize !== null) {
      widget.setContentSize(pendingSize.w, pendingSize.h);
      pendingSize = null;
    }

    clampToScreen();
    const { x, y } = widget.getBounds();
    try {
      writeFileSync(positionFile(), JSON.stringify({ x, y }));
    } catch {
      // Non-fatal.
    }
  }, SAVE_DEBOUNCE_MS);
}

/** Clamp fully onto the nearest display's work area (excludes taskbar). */
function clampToScreen(): void {
  if (widget === null || widget.isDestroyed()) return;
  const bounds = widget.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - bounds.width);
  const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - bounds.height);
  if (x !== bounds.x || y !== bounds.y) {
    clamping = true;
    widget.setBounds({ x, y, width: bounds.width, height: bounds.height });
    clamping = false;
  }
}

function isOnScreen(x: number, y: number): boolean {
  return screen.getAllDisplays().some((display) => {
    const { x: dx, y: dy, width, height } = display.bounds;
    return x >= dx && x < dx + width && y >= dy && y < dy + height;
  });
}

/** Saved position if still on-screen, otherwise bottom-right of primary work area. */
function startPosition(): { x: number; y: number } {
  const saved = loadPosition();
  if (saved !== null && isOnScreen(saved.x, saved.y)) return saved;
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  return {
    x: x + width - WIDGET_WIDTH - DEFAULT_MARGIN,
    y: y + height - WIDGET_HEIGHT - DEFAULT_MARGIN,
  };
}

/** Create (or re-show) the widget without taking focus. Safe to call repeatedly. */
export function showThroughputWidget(): void {
  if (widget !== null && !widget.isDestroyed()) {
    if (ready && !widget.isVisible()) widget.showInactive();
    return;
  }
  const { x, y } = startPosition();
  widget = new BrowserWindow({
    x,
    y,
    width: WIDGET_WIDTH,
    height: WIDGET_HEIGHT,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  widget.on("moved", () => {
    isDragging = true;
    if (clamping) return;
    savePositionDebounced();
  });
  widget.on("closed", () => {
    widget = null;
    ready = false;
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  });
  widget.webContents.once("did-finish-load", () => {
    ready = true;
    if (pending !== null) paintThroughputWidget(pending.down, pending.up);
    widget?.showInactive();
    clampToScreen();
  });
  void widget.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(PAGE));
}

/** Update the displayed readings. Queued until the page is ready. */
export function paintThroughputWidget(downLabel: string, upLabel: string): void {
  pending = { down: downLabel, up: upLabel };
  void renderRates(downLabel, upLabel);
}

async function renderRates(down: string, up: string): Promise<void> {
  if (widget === null || widget.isDestroyed() || !ready) return;
  try {
    const size = (await widget.webContents.executeJavaScript(
      `window.__setRates(${JSON.stringify(down)}, ${JSON.stringify(up)})`,
    )) as { w: number; h: number } | undefined;
    if (size === undefined || widget === null || widget.isDestroyed()) return;

    const [width, height] = widget.getContentSize();
    if (width !== size.w || height !== size.h) {
      if (isDragging) {
        // Defer resize until dragging finishes to avoid OS snapping glitches.
        pendingSize = size;
      } else {
        widget.setContentSize(size.w, size.h);
        clampToScreen();
      }
    }
  } catch {
    // Window tearing down; next paint recovers.
  }
}

export function hideThroughputWidget(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (widget !== null && !widget.isDestroyed()) widget.destroy();
  widget = null;
  ready = false;
  pending = null;
}
