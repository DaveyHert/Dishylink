// Live width of an element, for layout decisions that need real pixels rather
// than a guess — how many x-axis labels actually fit, say.

import { useEffect, useRef, useState } from "react";

export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width);
    });
    observer.observe(element);
    setWidth(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

/**
 * Label every Nth bar, skipping only as many as the width actually forces.
 * Ranges whose labels fit get all of them — the old fixed "at most 8" hid
 * labels there was room for.
 */
export function labelStride(containerWidth: number, barCount: number, labelPx: number): number {
  if (barCount === 0 || containerWidth === 0) return 1;
  const perBar = containerWidth / barCount;
  if (perBar <= 0) return 1;
  return Math.max(1, Math.ceil(labelPx / perBar));
}
