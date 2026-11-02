// Runs in the node project, which has no DOM, so storage is a stub: what is
// under test is which keys this module writes and reads, not the browser's
// implementation of localStorage.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  readLocale,
  setLocale,
  subscribeToLocale,
  SUPPORTED_LOCALES,
} = await import("./locale");

describe("locale store", () => {
  beforeEach(() => {
    store.clear();
  });

  it("defaults to English when no preference is stored", () => {
    expect(readLocale()).toBe(DEFAULT_LOCALE);
  });

  it("reads stored supported locale", () => {
    store.set(LOCALE_STORAGE_KEY, "es");
    expect(readLocale()).toBe("es");
  });

  it("ignores invalid stored locales", () => {
    store.set(LOCALE_STORAGE_KEY, "invalid-locale");
    expect(readLocale()).toBe(DEFAULT_LOCALE);
  });

  it("updates stored locale and notifies subscribers", () => {
    let notified = 0;
    const unsubscribe = subscribeToLocale(() => {
      notified += 1;
    });

    setLocale("fr");
    expect(store.get(LOCALE_STORAGE_KEY)).toBe("fr");
    expect(readLocale()).toBe("fr");
    expect(notified).toBe(1);

    unsubscribe();
    setLocale("de");
    expect(notified).toBe(1);
  });

  it("lists all supported locales with labels", () => {
    expect(SUPPORTED_LOCALES.map((l) => l.code)).toEqual(["en", "es", "fr", "de", "pt"]);
  });
});

describe("browser language detection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    store.clear();
  });

  it("strips the region from the browser language", () => {
    vi.stubGlobal("navigator", { language: "pt-BR", languages: ["pt-BR"] });
    expect(readLocale()).toBe("pt");
  });

  it("takes the first supported entry from the preference list", () => {
    vi.stubGlobal("navigator", { language: "nl-NL", languages: ["nl-NL", "de-DE", "en"] });
    expect(readLocale()).toBe("de");
  });

  it("falls back to English when nothing in the list is supported", () => {
    vi.stubGlobal("navigator", { language: "ja-JP", languages: ["ja-JP", "zh-CN"] });
    expect(readLocale()).toBe(DEFAULT_LOCALE);
  });

  it("prefers a stored choice over the browser language", () => {
    vi.stubGlobal("navigator", { language: "de-DE", languages: ["de-DE"] });
    store.set(LOCALE_STORAGE_KEY, "fr");
    expect(readLocale()).toBe("fr");
  });
});
