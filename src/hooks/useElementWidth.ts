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
 * Label every Nth bar, skipping only as many as the width actually forces. A
 * range whose labels all fit gets all of them — the stride is measured, never a
 * fixed cap, so no label is hidden while there is room for it.
 */
export function labelStride(containerWidth: number, barCount: number, labelPx: number): number {
  if (barCount === 0 || containerWidth === 0) return 1;
  const perBar = containerWidth / barCount;
  if (perBar <= 0) return 1;
  return Math.max(1, Math.ceil(labelPx / perBar));
}
