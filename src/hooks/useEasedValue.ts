// Eases a displayed number toward a target each animation frame (exponential
// smoothing) — a speedometer-style glide. Shared by the speed-test gauge and
// beam views so both animate identically.

import { useEffect, useRef, useState } from "react";

export function useEasedValue(target: number, factor = 0.14): number {
  const [displayed, setDisplayed] = useState(target);
  const displayedRef = useRef(target);
  const targetRef = useRef(target);
  targetRef.current = target;

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
