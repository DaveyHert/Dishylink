// GitHub-style 30-day calendar heatmap of daily connection quality.
//
// Each cell is one calendar day. Colour encodes the DayQuality bucket:
//   perfect  → accent green
//   good     → lighter green
//   degraded → amber
//   poor     → red
//   none     → muted (recorder wasn't running)
//
// Cells are arranged in a grid of weeks (columns) × weekdays (rows), matching
// the GitHub contribution graph orientation. The newest day is always the
// bottom-right cell.

import { useTranslation } from "react-i18next";
import type { DayBucket, DayQuality } from "@core/uptimeSummary";
import { formatDurationMs } from "../../lib/format";

const QUALITY_COLOR: Record<DayQuality, string> = {
  none: "var(--ink-muted)",
  perfect: "var(--status-good)",
  good: "color-mix(in srgb, var(--status-good) 55%, transparent)",
  degraded: "var(--status-warning)",
  poor: "var(--status-error)",
};

const QUALITY_OPACITY: Record<DayQuality, number> = {
  none: 0.12,
  perfect: 1,
  good: 1,
  degraded: 1,
  poor: 1,
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface UptimeHeatmapProps {
  days: DayBucket[];
}

export function UptimeHeatmap({ days }: UptimeHeatmapProps) {
  const { t } = useTranslation();

  if (days.length === 0) {
    return (
      <p className='py-4 text-center text-[13px] text-muted-foreground'>
        {t("uptime.heatmapEmpty")}
      </p>
    );
  }

  // Pad the start so the first cell lands on the correct weekday column.
  const firstDay = days[0];
  const firstDow = new Date(firstDay.dayMs).getDay(); // 0 = Sun
  const paddedDays: (DayBucket | null)[] = [
    ...Array<null>(firstDow).fill(null),
    ...days,
  ];

  // Split into weeks (columns of 7).
  const weeks: (DayBucket | null)[][] = [];
  for (let i = 0; i < paddedDays.length; i += 7) {
    weeks.push(paddedDays.slice(i, i + 7));
  }

  // Month label positions: first week-column where a new month begins.
  const monthLabels: { weekIndex: number; label: string }[] = [];
  let lastMonth = -1;
  for (let wi = 0; wi < weeks.length; wi++) {
    for (const cell of weeks[wi]) {
      if (!cell) continue;
      const d = new Date(cell.dayMs);
      if (d.getMonth() !== lastMonth) {
        lastMonth = d.getMonth();
        monthLabels.push({
          weekIndex: wi,
          label: d.toLocaleString("default", { month: "short" }),
        });
      }
      break;
    }
  }

  const cellSize = 13;
  const cellGap = 3;
  const step = cellSize + cellGap;
  const rowLabelWidth = 28;
  const svgWidth = rowLabelWidth + weeks.length * step;
  const svgHeight = 20 + 7 * step; // month labels row + 7 day rows

  return (
    <div className='overflow-x-auto'>
      <svg
        width={svgWidth}
        height={svgHeight}
        aria-label={t("uptime.heatmapAriaLabel")}
        role='img'
      >
        {/* Month labels */}
        {monthLabels.map(({ weekIndex, label }) => (
          <text
            key={`${label}-${weekIndex}`}
            x={rowLabelWidth + weekIndex * step}
            y={12}
            fontSize={10}
            fill='var(--ink-muted)'
            fontFamily='inherit'
          >
            {label}
          </text>
        ))}

        {/* Day-of-week row labels (Mon, Wed, Fri to save space) */}
        {[1, 3, 5].map((dow) => (
          <text
            key={dow}
            x={rowLabelWidth - 4}
            y={20 + dow * step + cellSize / 2 + 3}
            fontSize={9}
            fill='var(--ink-muted)'
            textAnchor='end'
            fontFamily='inherit'
          >
            {DAY_LABELS[dow]}
          </text>
        ))}

        {/* Day cells */}
        {weeks.map((week, wi) =>
          week.map((cell, di) => {
            if (!cell) return null;
            const x = rowLabelWidth + wi * step;
            const y = 20 + di * step;
            const color = QUALITY_COLOR[cell.quality];
            const opacity = QUALITY_OPACITY[cell.quality];
            const outageLabel =
              cell.totalOutageMs > 0
                ? ` · ${formatDurationMs(cell.totalOutageMs, t)} outage`
                : "";
            const title =
              cell.quality === "none"
                ? `${cell.dateLabel} — not recorded`
                : `${cell.dateLabel}${outageLabel}`;

            return (
              <rect
                key={cell.dayMs}
                x={x}
                y={y}
                width={cellSize}
                height={cellSize}
                rx={2.5}
                fill={color}
                opacity={opacity}
              >
                <title>{title}</title>
              </rect>
            );
          }),
        )}
      </svg>

      {/* Legend */}
      <div className='mt-2 flex items-center gap-3 text-[11px] text-muted-foreground'>
        <span>{t("uptime.legendLess")}</span>
        {(["none", "perfect", "good", "degraded", "poor"] as DayQuality[]).map((q) => (
          <span
            key={q}
            className='inline-block size-[11px] rounded-[2px]'
            style={{
              background: QUALITY_COLOR[q],
              opacity: QUALITY_OPACITY[q],
            }}
            title={t(`uptime.quality.${q}`)}
          />
        ))}
        <span>{t("uptime.legendMore")}</span>
      </div>
    </div>
  );
}
