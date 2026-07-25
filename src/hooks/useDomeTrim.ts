// React binding for the shared dome-trim choice.

import { useSyncExternalStore } from "react";
import { domeTrimEnabled, subscribeDomeTrim } from "../lib/domeTrim";

/** The live choice, re-rendering both domes whenever either end changes it. */
export function useDomeTrim(): boolean {
  return useSyncExternalStore(subscribeDomeTrim, domeTrimEnabled, () => false);
}
