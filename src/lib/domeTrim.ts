// Whether the obstruction dome hides the never-observed skirt around its base.
//
// One choice shared by both surfaces that draw a dome — the dashboard card and
// the full sky view — because they are the same dome seen at two sizes, and
// having one trimmed while the other is not reads as a bug rather than a
// setting. Either surface can set it, and both follow.
//
// Kept here rather than in React state for the same reason: the two live in
// different parts of the tree and would otherwise need the flag threaded through
// everything between them.

const STORAGE_KEY = "dishboard-dome-trim";

const listeners = new Set<() => void>();

/** Off unless it has been turned on, so an untouched install looks as it always did. */
export function domeTrimEnabled(): boolean {
  return typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "on";
}

export function setDomeTrimEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  for (const listener of listeners) listener();
}

export function subscribeDomeTrim(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
