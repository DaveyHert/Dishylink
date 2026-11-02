// Persistent energy totals for the Power detail: day / week / month totals with
// honest coverage and a simple bar chart. A distinct feed from the live window
// energy above it — fetched from the historian, not the in-memory samples.

import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  useEnergyHistory,
  type EnergyRange,
  type EnergyBucket,
} from "../../hooks/useEnergyHistory";
import { RangeBars, type RangeBarColumn } from "../shared/RangeBarChart";
import { rangeTabs, bucketLabel } from "../shared/rangeTabs";
import { SegmentedControl } from "../ui/segmented-control";
import { Callout } from "../ui/callout";
import { useTimeLocale } from "../../hooks/useTimeLocale";

/** Slot the historian only caught part of: its total is real but understates the period. */
function isPartial(bucket: EnergyBucket): boolean {
  return (
    bucket.kWh !== null &&
    bucket.expectedSeconds > 0 &&
    bucket.sampledSeconds / bucket.expectedSeconds < 0.9
  );
}

function bucketTitle(bucket: EnergyBucket, range: EnergyRange, t: TFunction, locale: string) {
  const when = bucketLabel(bucket.t, range, locale);
  if (bucket.kWh === null) return t("energy.bucketNoData", { when });
  const title = t("energy.bucketTotal", { when, kwh: bucket.kWh.toFixed(3) });
  if (!isPartial(bucket)) return title;
  return t("common.partialRecorded", {
    title,
    sampled: Math.round(bucket.sampledSeconds / 60),
    expected: Math.round(bucket.expectedSeconds / 60),
  });
}

function EnergyBars({ buckets, range }: { buckets: EnergyBucket[]; range: EnergyRange }) {
  const { t } = useTranslation();
  const timeLocale = useTimeLocale();
  const maxKWh = Math.max(...buckets.map((bucket) => bucket.kWh ?? 0), 1e-9);
  const columns: RangeBarColumn[] = buckets.map((bucket) => ({
    key: bucket.t,
    label: bucketLabel(bucket.t, range, timeLocale),
    title: bucketTitle(bucket, range, t, timeLocale),
    bar:
      bucket.kWh === null ? (
        // An empty slot, not a zero one: a faint full-height wash marks the
        // hole without claiming no energy was used.
        <div
          className='w-full min-h-[2px] rounded-t-[3px]'
          style={{ height: "100%", background: "var(--ink-muted)", opacity: 0.06 }}
        />
      ) : (
        <div
          className='w-full min-h-[2px] rounded-t-[3px] bg-chart-warm'
          style={{
            height: `${(bucket.kWh / maxKWh) * 100}%`,
            // Part-sampled slots are real but short by construction; fade one
            // so a low bar is not read as a quiet hour.
            opacity: isPartial(bucket) ? 0.45 : undefined,
          }}
        />
      ),
  }));
  return <RangeBars columns={columns} range={range} />;
}

export function EnergyHistoryPanel({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const [range, setRange] = useState<EnergyRange>("today");
  const { data, loading, unavailable } = useEnergyHistory(range, active);

  const coveragePct = data ? Math.round(data.coverage.fraction * 100) : 0;

  return (
    <div className='mt-4 border-t border-hairline pt-[13px]'>
      <div className='flex flex-wrap items-center justify-between gap-2.5'>
        <span className='text-[14.5px] font-[650]'>{t("energy.title")}</span>
        <SegmentedControl
          options={rangeTabs(t)}
          value={range}
          onChange={setRange}
          label={t("energy.rangeLabel")}
        />
      </div>

      {unavailable ? (
        <Callout className='mt-2.5'>
          <Trans i18nKey='energy.needsRecorder' components={{ code: <code /> }} />
        </Callout>
      ) : (
        <>
          <div className='mt-2.5 text-[27px] font-bold'>
            {data ? `${data.totalKWh.toFixed(data.totalKWh < 1 ? 3 : 2)} kWh` : loading ? "…" : "—"}
          </div>
          {data && (
            <div className='mt-1 text-[12px] font-medium text-muted-foreground'>
              {coveragePct < 95
                ? t("energy.collectedPartial", { percent: coveragePct })
                : t("energy.collected", { percent: coveragePct })}
            </div>
          )}
          {data && <EnergyBars buckets={data.buckets} range={range} />}
        </>
      )}
    </div>
  );
}
