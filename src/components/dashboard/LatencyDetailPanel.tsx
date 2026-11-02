// Latency detail: a glider switch between the live window (chart + distribution)
// and the persisted quality score/grade history.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TelemetrySample } from "@core/telemetry";
import { StatDetailPanel, type StatDetail } from "./StatDetailPanel";
import { LatencyQualityPanel } from "./LatencyQualityPanel";
import { SegmentedControl } from "../ui/segmented-control";

type LatencyView = "live" | "quality";

export function LatencyDetailPanel({
  detail,
  samples,
}: {
  detail: StatDetail;
  samples: TelemetrySample[];
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<LatencyView>("live");

  return (
    <div>
      <SegmentedControl
        options={[
          { label: t("metrics.live"), value: "live" as const },
          { label: t("metrics.quality"), value: "quality" as const },
        ]}
        value={view}
        onChange={setView}
        label={t("metrics.latencyView")}
        variant='glider'
        className='mb-1'
      />
      {view === "live" ? (
        <StatDetailPanel detail={detail} samples={samples} />
      ) : (
        <LatencyQualityPanel />
      )}
    </div>
  );
}
