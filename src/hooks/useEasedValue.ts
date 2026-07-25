// Eases a displayed number toward a target each animation frame (exponential
// smoothing) — a speedometer-style glide. Shared by the speed-test gauge and
// beam views so both animate identically.

import { useEffect, useRef, useState } from "react";

// `snapKey` snaps the displayed value straight to the current target whenever it
// changes, skipping the glide — for a fresh start where easing down from the last
// reading would be wrong (a new run should drop to 0 at once, not drain there).
export function useEasedValue(target: number, factor = 0.14, snapKey?: unknown): number {
  const [displayed, setDisplayed] = useState(target);
  const displayedRef = useRef(target);
  const targetRef = useRef(target);
  targetRef.current = target;

  const firstSnap = useRef(true);
  useEffect(() => {
    if (firstSnap.current) {
      firstSnap.current = false;
      return; // mount already starts displayed at the target
    }
    displayedRef.current = targetRef.current;
    setDisplayed(targetRef.current);
  }, [snapKey]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const goal = targetRef.current;
      const current = displayedRef.current;
      const next = Math.abs(goal - current) < 0.05 ? goal : current + (goal - current) * factor;
      if (next !== current) {
        displayedRef.current = next;
        setDisplayed(next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [factor]);

  return displayed;
}
