// The ⓘ affordance that reveals a plain-language tip on hover/focus. Shared by
// the satellite-view stat captions and the Network drill-in, so every "what does
// this mean?" hint in the app looks and behaves the same.

/** Standalone ⓘ dot. Pair with any heading; `.info-tip` anchors to the dot. */
export function InfoDot({ tip }: { tip: string }) {
  return (
    <span className="info-dot" tabIndex={0} role="note" aria-label={tip}>
      i<span className="info-tip">{tip}</span>
    </span>
  );
}

/** A stat caption with an ⓘ affordance — used to explain what each metric means. */
export function StatLabel({ children, tip }: { children: React.ReactNode; tip: string }) {
  return (
    <span className="stat-caption info-label">
      {children}
      <InfoDot tip={tip} />
    </span>
  );
}
