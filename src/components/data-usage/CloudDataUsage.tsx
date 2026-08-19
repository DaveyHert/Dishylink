// Starlink's own billing meter (the authoritative usage the portal shows),
// read from the account session via /cloud/usage. Monthly cycles + daily bars,
// laid out like the portal's Total Data Usage card. Distinct from the local
// "Local session" tab, which is historian-recorded and honest about gaps.

import { useMemo, useState } from "react";
import { useCloudUsage } from "../../hooks/useCloudAccount";
import { isUnlimited, formatAllowance, type UsageCycle } from "../../lib/starlinkCloud";
import { formatGigabytes } from "../../lib/format";
import { RangeBars, type RangeBarColumn } from "../shared/RangeBarChart";
import { SegmentedControl } from "../ui/segmented-control";
import { Callout } from "../ui/callout";
import { EmptyState } from "../ui/empty-state";
import { Loading } from "../ui/loading";
import { Explainer } from "../ui/explainer";
import { ConnectAccount } from "../shared/ConnectAccount";

function formatGB(gb: number): string {
  const { value, unit } = formatGigabytes(gb);
  return `${value} ${unit}`;
}

function cycleMonthLabel(cycle: UsageCycle): string {
  return new Date(cycle.startDate).toLocaleDateString([], { month: "short", timeZone: "UTC" });
}

function CycleBars({ cycle }: { cycle: UsageCycle }) {
  const start = new Date(cycle.startDate);
  const maxGB = Math.max(...cycle.dailyData.map((day) => day[0] ?? 0), 1e-9);
  const columns: RangeBarColumn[] = cycle.dailyData.map((day, index) => {
    const gb = day[0] ?? 0;
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const when = date.toLocaleDateString([], { month: "numeric", day: "numeric", timeZone: "UTC" });
    return {
      key: index,
      label: String(date.getUTCDate()),
      title: `${when} · ${formatGB(gb)}`,
      bar: (
        <div
          className='w-full rounded-t-[3px] bg-chart-ink opacity-80'
          style={{ height: `${(gb / maxGB) * 100}%` }}
        />
      ),
    };
  });
  return (
    <RangeBars
      columns={columns}
      range='month'
      labelWidthPx={16}
      heightPx={150}
      yAxis={{ max: maxGB, format: (v) => `${Math.round(v)} GB` }}
    />
  );
}

const NO_CYCLES: UsageCycle[] = [];

export function CloudDataUsage({ active }: { active: boolean }) {
  const { data, status, reload } = useCloudUsage(active);
  // `content` is optional-chained too: this is unvalidated upstream JSON, and an
  // envelope without it would otherwise throw and take the whole panel down
  // instead of falling through to the error branch below.
  // One shared empty array for the absent case: a fresh `[]` each render is a new
  // identity, which would rebuild every memo keyed on it on every render.
  const cycles = data?.content?.billingCyclesAnnotated ?? NO_CYCLES;
  const plan = data?.content?.servicePlan;
  const [selected, setSelected] = useState<number | null>(null);

  // Cycles arrive oldest-first (verified against the live endpoint), so the
  // newest is the last entry. Clamped so a reload that returns fewer cycles
  // can't strand the selection past the end of the list.
  const newestIndex = Math.max(cycles.length - 1, 0);
  const selectedIndex = Math.min(selected ?? newestIndex, newestIndex);
  const cycle = cycles[selectedIndex];

  const monthOptions = useMemo(
    () => cycles.map((c, i) => ({ label: cycleMonthLabel(c), value: String(i) })),
    [cycles],
  );

  if (status === "not-connected") {
    // Same framing as the account panel's connect state, so switching between the
    // two tabs doesn't move the panel around.
    return (
      <div className='flex min-h-[360px] items-center justify-center px-4 py-8'>
        <ConnectAccount onConnected={reload} />
      </div>
    );
  }
  if (status === "error") {
    return (
      <Callout tone='error' className='mt-2.5'>
        Couldn’t reach Starlink’s usage service. Check your internet and try again.
      </Callout>
    );
  }
  if (status === "loading") {
    return <Loading message='Loading Starlink billing data…' size={26} stacked />;
  }
  // Ready but nothing to draw — a service line whose first billing cycle hasn't
  // been reported yet. An empty state, not a pending one: a spinner here would
  // promise data that is not coming.
  if (!cycle) {
    return (
      <EmptyState className='mt-6'>
        Starlink hasn’t reported a billing cycle for this service line yet.
      </EmptyState>
    );
  }

  const unlimited = isUnlimited(plan);

  return (
    <div>
      <div className='mt-3 mb-3.5'>
        <div className='text-[34px] leading-[1.05] font-bold tracking-[-0.01em]'>
          {formatGB(cycle.totalAmountGB)}
          <span className='ml-[6px] align-baseline text-[13px] font-medium'>
            {data?.content?.dataBuckets?.[0]?.name ?? "Data"}
          </span>
        </div>
        <div className='mt-0.5 text-[12px] font-medium text-muted-foreground'>
          <span className='mr-1 font-semibold'>Usage Limit:</span>
          {unlimited
            ? `${formatAllowance(plan?.usageLimitGB)} included (unlimited)`
            : `of ${formatAllowance(plan?.usageLimitGB)} included`}
        </div>
      </div>

      {monthOptions.length > 1 && (
        <SegmentedControl
          options={monthOptions}
          value={String(selectedIndex)}
          onChange={(value) => setSelected(Number(value))}
          label='Billing cycle month'
          className='mb-2.5'
        />
      )}

      <CycleBars cycle={cycle} />
      <div className='mt-1 text-[12px] font-medium'>
        {new Date(cycle.startDate).toLocaleDateString([], {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        })}{" "}
        –{" "}
        {new Date(cycle.endDate).toLocaleDateString([], {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        })}{" "}
        · billing cycle
      </div>

      <Explainer title='Where does this come from?'>
        This is Starlink’s own billing meter, read from your account. It’s complete and counted in
        UTC — the authoritative figure your statement uses.
      </Explainer>
    </div>
  );
}
