import { describe, expect, it } from "vitest";
import { readWhatsNewDue, WHATS_NEW_RELEASE } from "./whatsNew";

function storageWith(entries: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
}

describe("what's new", () => {
  it("stays quiet on a fresh install, and stays quiet after", () => {
    const storage = storageWith();
    expect(readWhatsNewDue(storage)).toBe(false);
    expect(readWhatsNewDue(storage)).toBe(false);
  });

  it("ignores other sites' keys when judging a fresh install", () => {
    expect(readWhatsNewDue(storageWith({ "some-other-app": "1" }))).toBe(false);
  });

  it("shows to an upgrade from a build that never recorded what it showed", () => {
    expect(readWhatsNewDue(storageWith({ "dishylink-theme": "dark" }))).toBe(true);
  });

  it("keeps showing until it is marked seen", () => {
    const storage = storageWith({ "dishylink-theme": "dark" });
    expect(readWhatsNewDue(storage)).toBe(true);
    expect(readWhatsNewDue(storage)).toBe(true);
  });

  it("shows when the last highlights seen were an earlier release's", () => {
    expect(readWhatsNewDue(storageWith({ "dishylink-whats-new-seen": "1.2" }))).toBe(true);
  });

  it("stays quiet once this release's highlights were seen", () => {
    const storage = storageWith({
      "dishylink-theme": "dark",
      "dishylink-whats-new-seen": WHATS_NEW_RELEASE,
    });
    expect(readWhatsNewDue(storage)).toBe(false);
  });
});
