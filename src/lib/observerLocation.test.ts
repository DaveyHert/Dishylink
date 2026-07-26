// Runs in the node project, which has no DOM, so storage is a stub: what is
// under test is which keys this module writes and reads, not the browser's
// implementation of localStorage.

import { beforeEach, describe, expect, test } from "vitest";

const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
  key: (index: number) => [...store.keys()][index] ?? null,
  get length() {
    return store.size;
  },
} as Storage;

const { loadSavedLocation, loadLocationCleared, saveLocation, clearSavedLocation } =
  await import("./observerLocation");

const SITE = { latitudeDeg: 4.8172, longitudeDeg: 6.9679, altitudeM: 0 };

beforeEach(() => store.clear());

describe("the cleared flag", () => {
  // "Clear" means unset. An automatic source may fill in for someone who has
  // never chosen a location, but must never undo a deliberate clear — so the
  // two states have to stay tellable apart, both being "no saved location".
  test("a fresh install has not cleared anything", () => {
    expect(loadSavedLocation()).toBeNull();
    expect(loadLocationCleared()).toBe(false);
  });

  test("clearing is remembered, so it cannot be silently filled back in", () => {
    saveLocation(SITE);
    clearSavedLocation();
    expect(loadSavedLocation()).toBeNull();
    expect(loadLocationCleared()).toBe(true);
  });

  test("setting a location un-clears, so the next clear still reads as new", () => {
    clearSavedLocation();
    saveLocation(SITE);
    expect(loadSavedLocation()).toEqual(SITE);
    expect(loadLocationCleared()).toBe(false);
  });
});
