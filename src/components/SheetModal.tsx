// Generic modal sheet sharing the StatDetailModal chrome (same overlay /
// sheet / header classes) for non-stat drill-downs: Speed test, Alignment,
// Terminal. Closes on backdrop click and Escape.

import { useEffect, type ReactNode } from "react";

interface SheetModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: "default" | "wide" | "xl";
}

const SIZE_CLASS: Record<NonNullable<SheetModalProps["size"]>, string> = {
  default: "detail-sheet",
  wide: "detail-sheet detail-sheet-wide",
  xl: "detail-sheet detail-sheet-xl",
};

export function SheetModal({ title, onClose, children, size = "default" }: SheetModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="detail-overlay" onClick={onClose}>
      <div
        className={SIZE_CLASS[size]}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="detail-header">
          <span className="detail-title">{title}</span>
          <button className="detail-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
