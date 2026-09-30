// Whether throughput figures read in bits (Mbps — the dish's own unit and the
// default) or bytes (MB/s). A display choice, so a tiny external store like
// toolbarStyle.ts: the formatters read it at call time and anything that renders
// a rate subscribes, so the settings tab and the dashboard stay in step.
//
// localStorage is the store on every host. On the desktop app the main process
// owns the canonical value too — the menu-bar readout paints from the recorder
// with no window open, where localStorage does not reach — so there the store
// follows main and writes through to it.

export type ThroughputUnit = "bits" | "bytes";

const STORAGE_KEY = "dishylink-throughput-unit";

const listeners = new Set<() => void>();

/** Only an exact "bytes" counts as a choice, so anything else reads as bits. */
function parseUnit(value: unknown): ThroughputUnit {
  return value === "bytes" ? "bytes" : "bits";
}

export function readThroughputUnit(): ThroughputUnit {
  return typeof localStorage !== "undefined"
    ? parseUnit(localStorage.getItem(STORAGE_KEY))
    : "bits";
}

/** Store a unit locally and tell subscribers, without echoing it back to main. */
function store(unit: ThroughputUnit): void {
  if (readThroughputUnit() === unit) return;
  localStorage.setItem(STORAGE_KEY, unit);
  for (const listener of listeners) listener();
}

/** The desktop bridge, or undefined on hosts without one (and with no window). */
function desktopHost() {
  return typeof window === "undefined" ? undefined : window.dishlink;
}

export function setThroughputUnit(unit: ThroughputUnit): void {
  store(unit);
  void desktopHost()
    ?.setThroughputUnit?.(unit)
    .then((stored) => store(parseUnit(stored)));
}

let hostConnected = false;

/** On the desktop app, take main's value and follow its changes. Once only, on the
 *  first subscriber, so importing the formatters has no side effects. */
function connectHost(): void {
  if (hostConnected) return;
  const host = desktopHost();
  if (typeof host?.throughputUnit !== "function") return;
  hostConnected = true;
  void host.throughputUnit().then((unit) => store(parseUnit(unit)));
  host.onThroughputUnit?.((unit) => store(parseUnit(unit)));
}

export function subscribeToThroughputUnit(listener: () => void): () => void {
  connectHost();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
