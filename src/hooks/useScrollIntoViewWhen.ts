// A control that reveals its confirmation on demand can reveal it below the
// fold, leaving the decision on screen and the reason for it off it.

import { useEffect, useRef } from "react";

/** Brings the returned element into view each time `active` turns true. */
export function useScrollIntoViewWhen<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    // "nearest" moves the minimum needed, so a control already on screen stays
    // where the reader left it.
    if (active) ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [active]);
  return ref;
}
