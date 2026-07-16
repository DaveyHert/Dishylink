// Generic modal sheet sharing the StatDetailModal chrome (same overlay /
// sheet / header classes) for non-stat drill-downs: Speed test, Alignment,
// Terminal. Closes on backdrop click and Escape.

import { useEffect, type ReactNode } from "react";

interface SheetModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: "default" | "wide" | "xl" | "xxl";
  /** Set while the sheet shows a drill-in: puts a back chevron beside the title,
   *  where the app keeps it, instead of a separate nav row in the body. */
  onBack?: () => void;
}

const SIZE_CLASS: Record<NonNullable<SheetModalProps["size"]>, string> = {
  default: "detail-sheet",
  wide: "detail-sheet detail-sheet-wide",
  xl: "detail-sheet detail-sheet-xl",
  xxl: "detail-sheet detail-sheet-xxl",
};

export function SheetModal({ title, onClose, children, size = "default", onBack }: SheetModalProps) {
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
          {onBack && (
            <button className="detail-back" onClick={onBack} aria-label="Back">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
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
