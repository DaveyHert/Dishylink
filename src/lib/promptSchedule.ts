const DAY_MS = 24 * 60 * 60 * 1000;
const SNOOZE_MS = 2 * DAY_MS;
const RETIRED = "retired";
const INSTALLED_KEY = "dishylink-installed-at";

export type PromptId = "rating" | "donation";

const FIRST_ASK_AFTER: Record<PromptId, number> = {
  rating: 0,
  donation: DAY_MS,
};

function key(id: PromptId): string {
  return `dishylink-prompt-${id}`;
}

function stored(id: PromptId): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(key(id));
}

// First read stamps the install, so an upgrade from a build without this starts
// its clock now rather than asking on the spot.
function installedAt(now: number): number {
  if (typeof localStorage === "undefined") return now;
  const value = Number(localStorage.getItem(INSTALLED_KEY));
  if (Number.isFinite(value) && value > 0) return value;
  localStorage.setItem(INSTALLED_KEY, String(now));
  return now;
}

export function promptDue(id: PromptId, now: number = Date.now()): boolean {
  if (now < installedAt(now) + FIRST_ASK_AFTER[id]) return false;

  const value = stored(id);
  if (value === null) return true;
  if (value === RETIRED) return false;
  const until = Number(value);
  // An unreadable value asks again rather than going silent forever.
  return !Number.isFinite(until) || now >= until;
}

export function snoozePrompt(id: PromptId, now: number = Date.now()): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key(id), String(now + SNOOZE_MS));
}

export function retirePrompt(id: PromptId): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key(id), RETIRED);
}
