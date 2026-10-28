// Browser-project setup. Loads the real stylesheet so component tests resolve the
// same cascade, tokens and @theme mappings the app does — without it,
// getComputedStyle would report defaults and every fidelity assertion would be
// meaningless.
import "./index.css";
import "./i18n";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "vitest-browser-react";
import { noteCloudSessionChanged } from "./lib/cloudHost";
import { LOCALE_STORAGE_KEY, setLocale } from "./lib/locale";
import { setTimeFormat, TIME_FORMAT_STORAGE_KEY } from "./lib/timeFormat";

// One account answer is shared by every surface in the app, and by every test in
// a file. Left alone, the first test decides what the account says for all of
// them. Unmounting first is what makes dropping it take: a component still
// watching refetches immediately, through whichever transport that test left set.
//
// The chosen language and clock style persist in localStorage, which every test
// file in the browser project shares, and i18n reads the language once when a
// file loads. A test that switches either would otherwise start the next file
// in that language or on that clock.
afterEach(() => {
  cleanup();
  noteCloudSessionChanged();
  localStorage.removeItem(LOCALE_STORAGE_KEY);
  localStorage.removeItem(TIME_FORMAT_STORAGE_KEY);
});
beforeEach(() => {
  noteCloudSessionChanged();
  setLocale("en");
  setTimeFormat("auto");
});
