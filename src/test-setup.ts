// Browser-project setup. Loads the real stylesheet so component tests resolve the
// same cascade, tokens and @theme mappings the app does — without it,
// getComputedStyle would report defaults and every fidelity assertion would be
// meaningless.
import "./index.css";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "vitest-browser-react";
import { noteCloudSessionChanged } from "./lib/cloudHost";

// One account answer is shared by every surface in the app, and by every test in
// a file. Left alone, the first test decides what the account says for all of
// them. Unmounting first is what makes dropping it take: a component still
// watching refetches immediately, through whichever transport that test left set.
afterEach(() => {
  cleanup();
  noteCloudSessionChanged();
});
beforeEach(() => noteCloudSessionChanged());
