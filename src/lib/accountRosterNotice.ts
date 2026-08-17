// Whether the reader has waved away the note explaining that these devices came
// from their Starlink account.
//
// A kit left in bypass is in that state for good, so the explanation is news
// once and furniture forever after. Kept in localStorage rather than dish config
// for the same reason the toolbar choice is: it describes this install's
// reading, not the kit.

const STORAGE_KEY = "dishylink-account-roster-notice-dismissed";

export function accountRosterNoticeDismissed(): boolean {
  return typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "1";
}

/** Cleared when the router answers again, so the next outage is surfaced as the
 *  fresh event it is rather than inheriting an answer given about an older one. */
export function setAccountRosterNoticeDismissed(dismissed: boolean): void {
  if (typeof localStorage === "undefined") return;
  if (dismissed) localStorage.setItem(STORAGE_KEY, "1");
  else localStorage.removeItem(STORAGE_KEY);
}
