// Uptime / SLA dashboard panel.
//
// Shows monthly uptime percentage, MTBF, MTTR, outage count, and a
// GitHub-style 30-day heatmap of daily connection quality.
// All data is derived purely from the postmortem store — no new polling.

import { useTranslation } from "react-i18next";
import { useUptimeSummary } from "../../hooks/useUptimeSummary";
import { UptimeHeatmap } from "./UptimeHeatmap";
import { SectionCard } from "../ui/section-card";
import { formatDurationMs } from "../../lib/format";
import { cn } from "@/lib/utils";

// ---- Stat tile ----

interface StatProps {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}

function Stat({ label, value, sub, accent }: StatProps) {
  return (
    <div className='flex flex-col gap-0.5 rounded-xl bg-card px-5 py-4'>
      <span className='text-[12px] font-medium text-muted-foreground'>{label}</span>
      <span
        className={cn(
          "text-[28px] font-semibold leading-none tracking-tight",
          accent ? "text-[var(--status-good)]" : "text-foreground",
        )}
      >
        {value}
      </span>
      {sub && <span className='mt-0.5 text-[11px] text-muted-foreground'>{sub}</span>}
    </div>
  );
}

// ---- Panel ----

export function UptimePanel() {
  const { t } = useTranslation();
  const summary = useUptimeSummary();

  if (!summary) {
    return (
      <main className='mx-auto flex max-w-[1400px] flex-col gap-3.5 px-6 pt-3.5 pb-20 animate-[rise_400ms_ease_both]'>
        <p className='text-[14px] text-muted-foreground'>{t("uptime.loading")}</p>
      </main>
    );
  }

  const noData = summary.outageCount === 0 && summary.days.every((d) => d.quality === "none");

  const mtbfLabel =
    summary.mtbfMs !== null ? formatDurationMs(summary.mtbfMs, t) : t("uptime.na");
  const mttrLabel =
    summary.mttrMs !== null ? formatDurationMs(summary.mttrMs, t) : t("uptime.na");
  const totalOutageLabel =
    summary.totalOutageMs > 0 ? formatDurationMs(summary.totalOutageMs, t) : t("uptime.none");

  return (
    <main className='mx-auto flex max-w-[1400px] flex-col gap-3.5 px-6 pt-3.5 pb-20 animate-[rise_400ms_ease_both]'>
      <h1 className='text-[20px] font-semibold tracking-tight text-foreground'>
        {t("uptime.title")}
      </h1>

      {noData && (
        <p className='text-[13px] text-muted-foreground'>{t("uptime.noDataYet")}</p>
      )}

      {/* Stat row */}
      <section className='grid grid-cols-2 gap-3.5 sm:grid-cols-4'>
        <Stat
          label={t("uptime.statUptime")}
          value={summary.uptimePercent}
          sub={t("uptime.statUptimeSub", { days: 30 })}
          accent={summary.uptimeFraction >= 0.999}
        />
        <Stat
          label={t("uptime.statOutages")}
          value={String(summary.outageCount)}
          sub={t("uptime.statOutagesSub", { duration: totalOutageLabel })}
        />
        <Stat
          label={t("uptime.statMTBF")}
          value={mtbfLabel}
          sub={t("uptime.statMTBFSub")}
        />
        <Stat
          label={t("uptime.statMTTR")}
          value={mttrLabel}
          sub={t("uptime.statMTTRSub")}
        />
      </section>

      {/* Heatmap */}
      <SectionCard
        title={t("uptime.heatmapTitle")}
        meta={t("uptime.heatmapMeta")}
      >
        <UptimeHeatmap days={summary.days} />
      </SectionCard>

      {/* How is this measured? */}
      <p className='text-[12px] text-muted-foreground'>
        {t("uptime.howMeasured")}
      </p>
    </main>
  );
}
