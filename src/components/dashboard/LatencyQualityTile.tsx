// Tile for the Latency quality score. Shows the day-so-far score (0–100, with
// its A–F grade) and opens the full quality view. Pulls the same persisted
// summary the panel draws, so the two never disagree about the number.

import { useLatencyHistory } from "../../hooks/useLatencyHistory";
import { StatTile } from "./StatTile";

export function LatencyQualityTile({ onOpen }: { onOpen: () => void }) {
  const { data, loading, unavailable } = useLatencyHistory("today", true);

  const value = unavailable ? "—" : data ? String(data.score) : loading ? "…" : "—";
  const unit = data && !unavailable ? data.grade : "";
  const caption = unavailable
    ? "recorder off"
    : data
      ? `today · ${data.dish.p95 !== null ? `${data.dish.p95.toFixed(0)} ms p95` : "no data"}`
      : "today";

  return (
    <StatTile
      label='Latency quality'
      value={value}
      unit={unit}
      caption={caption}
      onOpenDetail={onOpen}
    />
  );
}
