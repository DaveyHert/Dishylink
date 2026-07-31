// Which navigation chrome the dashboard wears: the floating macOS-style dock
// (default) or the left rail. It is an app-local display choice, so it lives in
// localStorage rather than dish config — and both the dashboard (which renders
// it) and the settings tab (which sets it) sit in different parts of the tree,
// so a tiny external store keeps them in step without threading a prop between.

export type NavStyle = "dock" | "rail";

const STORAGE_KEY = "dishboard-nav-style";

const listeners = new Set<() => void>();

/** Dock unless the rail has been chosen, so an untouched install gets the default. */
export function readNavStyle(): NavStyle {
  return typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "rail"
    ? "rail"
    : "dock";
}

export function setNavStyle(style: NavStyle): void {
  localStorage.setItem(STORAGE_KEY, style);
  for (const listener of listeners) listener();
}

export function subscribeToNavStyle(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
