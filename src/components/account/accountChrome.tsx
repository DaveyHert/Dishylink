// Presentational pieces the account view is built from: a labelled field, the
// card frame, and the device status berry.

import type { ReactNode } from "react";
import type { DeviceStatus } from "../../lib/starlinkCloud";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className='min-w-0'>
      <div className='text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>
        {label}
      </div>
      <div className='mt-1 text-[14px] font-medium leading-snug'>{children}</div>
    </div>
  );
}

export function Card({
  title,
  meta,
  children,
  border = true,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  border?: boolean;
}) {
  return (
    <div
      className={`flex min-w-0 flex-col ${border ? "border border-border/70" : ""} rounded-xl bg-card px-[18px] py-4`}
    >
      <div className='mb-2.5 flex items-center justify-between gap-3'>
        <span className='text-[16px] font-semibold tracking-[0.005em] text-foreground'>
          {title}
        </span>
        {meta}
      </div>
      {children}
    </div>
  );
}

const STATUS_COLOR: Record<DeviceStatus, string> = {
  online: "var(--status-good)",
  offline: "var(--status-critical)",
  inactive: "var(--ink-muted)",
};

export function StatusDot({ status }: { status: DeviceStatus }) {
  return (
    <span
      className='inline-block h-2 w-2 shrink-0 rounded-full'
      style={{ background: STATUS_COLOR[status] }}
    />
  );
}
