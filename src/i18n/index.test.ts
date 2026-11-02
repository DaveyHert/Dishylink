import { beforeEach, describe, expect, it } from "vitest";

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

const { default: i18n, resources } = await import("./index");
const { setLocale } = await import("../lib/locale");

describe("i18n setup", () => {
  beforeEach(() => {
    store.clear();
    setLocale("en");
  });

  it("loads English translations by default", () => {
    expect(i18n.t("common.settings")).toBe("Settings");
    expect(i18n.t("settings.language")).toBe("Language");
  });

  it("switches to Spanish when locale is changed", async () => {
    setLocale("es");
    expect(i18n.language).toBe("es");
    expect(i18n.t("common.settings")).toBe("Configuración");
    expect(i18n.t("settings.language")).toBe("Idioma");
  });

  it("switches to French when locale is changed", async () => {
    setLocale("fr");
    expect(i18n.language).toBe("fr");
    expect(i18n.t("common.settings")).toBe("Paramètres");
    expect(i18n.t("settings.language")).toBe("Langue");
  });

  it("switches to German when locale is changed", async () => {
    setLocale("de");
    expect(i18n.language).toBe("de");
    expect(i18n.t("common.settings")).toBe("Einstellungen");
    expect(i18n.t("settings.language")).toBe("Sprache");
  });

  it("switches to Portuguese when locale is changed", async () => {
    setLocale("pt");
    expect(i18n.language).toBe("pt");
    expect(i18n.t("common.settings")).toBe("Configurações");
    expect(i18n.t("settings.language")).toBe("Idioma");
  });

  // Compared by base key, not literal key: a language's plural forms (_one,
  // _few, _many…) are its own business, so long as the message itself exists.
  // Placeholders are compared too — a translation that drops {{count}} or
  // renames it renders the raw token.
  const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
  const flatten = (value: object, prefix = ""): [string, string][] =>
    Object.entries(value).flatMap(([key, child]) =>
      typeof child === "object" && child !== null
        ? flatten(child, `${prefix}${key}.`)
        : [[`${prefix}${key}`, String(child)]],
    );
  const messages = (catalog: object) => {
    const byBase = new Map<string, Set<string>>();
    for (const [key, text] of flatten(catalog)) {
      const base = key.replace(PLURAL_SUFFIX, "");
      const tokens = byBase.get(base) ?? new Set<string>();
      for (const token of text.match(/\{\{\s*\w+/g) ?? []) tokens.add(token.replace(/\W/g, ""));
      for (const tag of text.match(/<\w+>/g) ?? []) tokens.add(tag);
      byBase.set(base, tokens);
    }
    return byBase;
  };
  const english = messages(resources.en.translation);

  for (const [code, resource] of Object.entries(resources)) {
    it(`${code} carries every English message with the same placeholders`, () => {
      const catalog = messages(resource.translation);
      expect([...catalog.keys()].sort()).toEqual([...english.keys()].sort());
      for (const [base, tokens] of english) {
        expect([...catalog.get(base)!].sort(), base).toEqual([...tokens].sort());
      }
    });
  }
});
