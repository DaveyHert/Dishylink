// Portal-style account view from the user's own starlink.com session (read-only):
// identity, plan, service address, and the dish/router device list. Mirrors
// starlink.com/account. Cloud-only (see CLOUD-ACCOUNT.md), entirely separate
// from the local dish surfaces.

import { useMemo, useState, type ReactNode } from "react";
import { useCloudAccount } from "../../hooks/useCloudAccount";
import {
  dishDisplayName,
  routerDisplayName,
  dishStatus,
  routerStatus,
  dishTelemetryId,
  routerTelemetryId,
  routerHardwareName,
  connectionLabel,
  formatUptime,
  type CloudTerminal,
  type CloudRouter,
  type DeviceStatus,
  type DeviceTelemetry,
  type DishTelemetry,
  type RouterTelemetry,
} from "../../lib/starlinkCloud";
import { Loading } from "../ui/loading";
import { Callout } from "../ui/callout";
import { ConnectAccount } from "../shared/ConnectAccount";
import { disconnectCloud } from "../../lib/starlinkCloud";
import { DishIcon } from "../icons/DishIcon";
import { RouterIcon } from "../icons/RouterIcon";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className='min-w-0'>
      <div className='text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>
        {label}
      </div>
      <div className='mt-1 text-[14px] font-medium leading-snug'>{children}</div>
    </div>
  );
}

function Card({
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
        <span className='text-[16px] font-semibold tracking-[0.005em] text-foreground'>{title}</span>
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

function StatusDot({ status }: { status: DeviceStatus }) {
  return (
    <span
      className='inline-block h-2 w-2 shrink-0 rounded-full'
      style={{ background: STATUS_COLOR[status] }}
    />
  );
}

interface DeviceItem {
  key: string;
  kind: "dish" | "router";
  name: string;
  status: DeviceStatus;
  /** True for an inactive dish and every router under it — grouped at the bottom. */
  groupInactive: boolean;
  terminal?: CloudTerminal;
  router?: CloudRouter;
  tel?: DeviceTelemetry;
}

function buildDeviceList(
  terminals: CloudTerminal[],
  deviceTelemetry: Record<string, DeviceTelemetry>,
): DeviceItem[] {
  const active: DeviceItem[] = [];
  const inactive: DeviceItem[] = [];
  terminals.forEach((terminal, terminalIndex) => {
    const tel = deviceTelemetry[dishTelemetryId(terminal)];
    const status = dishStatus(terminal, tel);
    const groupInactive = status === "inactive";
    const bucket = groupInactive ? inactive : active;
    bucket.push({
      // Stable key: falling back to a fresh random id every render remounts the
      // whole subtree each pass and feeds a render loop.
      key: terminal.userTerminalId ?? `dish-${terminalIndex}`,
      kind: "dish",
      name: dishDisplayName(terminal),
      status,
      groupInactive,
      terminal,
      tel,
    });
    const routerItems: DeviceItem[] = (terminal.routers ?? []).map((router, routerIndex) => {
      const rtel = deviceTelemetry[routerTelemetryId(router.routerId)] as
        | RouterTelemetry
        | undefined;
      return {
        key: router.routerId ?? `router-${terminalIndex}-${routerIndex}`,
        kind: "router",
        name: routerDisplayName(router.routerId, rtel),
        status: routerStatus(rtel, groupInactive),
        groupInactive,
        router,
        tel: rtel,
      };
    });
    // Online routers above offline ones under the same dish.
    routerItems.sort((a, b) => (a.status === "online" ? 0 : 1) - (b.status === "online" ? 0 : 1));
    bucket.push(...routerItems);
  });
  return [...active, ...inactive];
}

function lastUpdated(tel: DeviceTelemetry | undefined): string {
  return tel ? new Date(tel.timestampMs).toLocaleString() : "—";
}

function DeviceDetail({ item }: { item: DeviceItem }) {
  const fields: { label: string; value: ReactNode; mono?: boolean }[] = [];
  if (item.kind === "dish") {
    const t = item.terminal!;
    const tel = item.tel as DishTelemetry | undefined;
    fields.push(
      { label: "Starlink ID", value: t.userTerminalId ?? "—", mono: true },
      { label: "Serial number", value: t.dishSerialNumber ?? "—", mono: true },
      { label: "Kit number", value: t.serialNumber ?? "—", mono: true },
      { label: "Software version", value: tel?.softwareVersion ?? "—", mono: true },
      { label: "Uptime", value: formatUptime(tel?.uptimeS) },
      { label: "Last updated", value: lastUpdated(tel) },
      {
        label: "Time obstructed",
        value: tel?.obstructionPct != null ? `${(tel.obstructionPct * 100).toFixed(2)}%` : "—",
      },
      {
        label: "Last connected",
        value: t.lastConnected ? new Date(t.lastConnected).toLocaleString() : "—",
      },
    );
  } else {
    const r = item.router!;
    const tel = item.tel as RouterTelemetry | undefined;
    fields.push(
      { label: "Router ID", value: r.routerId ?? "—", mono: true },
      { label: "Hardware version", value: routerHardwareName(tel?.hardwareVersion) },
      { label: "Software version", value: tel?.softwareVersion ?? "—", mono: true },
      { label: "Clients", value: tel?.clients != null ? String(tel.clients) : "—" },
      { label: "Uptime", value: formatUptime(tel?.uptimeS) },
      { label: "Connection to Starlink", value: connectionLabel(tel?.hops) },
      { label: "Bypassed", value: tel ? (tel.isBypassed ? "Yes" : "No") : "—" },
      { label: "Last updated", value: lastUpdated(tel) },
    );
  }
  return (
    <div className='rounded-xl border border-border/70 p-4 bg-background/30'>
      <div className='mb-3 flex items-center gap-2.5'>
        {item.kind === "dish" ? (
          <DishIcon className={item.status !== "online" ? "opacity-40" : undefined} />
        ) : (
          <RouterIcon className={item.status !== "online" ? "opacity-40" : undefined} />
        )}
        <span className='text-[15px] font-semibold'>{item.name}</span>
        <span className='ml-auto flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground'>
          <StatusDot status={item.status} />
          {item.status}
        </span>
      </div>
      <div className='grid grid-cols-2 gap-4 max-[520px]:grid-cols-1'>
        {fields.map((field) => (
          <Field key={field.label} label={field.label}>
            {field.mono ? <span className='mono-value break-all'>{field.value}</span> : field.value}
          </Field>
        ))}
      </div>
    </div>
  );
}

function DevicesSection({
  terminals,
  deviceTelemetry,
}: {
  terminals: CloudTerminal[];
  deviceTelemetry: Record<string, DeviceTelemetry>;
}) {
  const items = useMemo(
    () => buildDeviceList(terminals, deviceTelemetry),
    [terminals, deviceTelemetry],
  );
  const [selectedKey, setSelectedKey] = useState<string | undefined>(items[0]?.key);
  const selected = items.find((i) => i.key === selectedKey) ?? items[0];

  if (items.length === 0) {
    return <div className='text-[13px] text-muted-foreground'>No devices on this account.</div>;
  }
  const firstInactiveKey = items.find((i) => i.groupInactive)?.key;

  return (
    <div className='grid grid-cols-[minmax(180px,220px)_1fr] gap-4 max-[720px]:grid-cols-1 '>
      <ul className='m-0 flex list-none flex-col gap-0.5 p-0'>
        {items.map((item) => (
          <li key={item.key}>
            {item.key === firstInactiveKey && (
              <div className='mt-2 mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>
                Inactive
              </div>
            )}
            <button
              type='button'
              onClick={() => setSelectedKey(item.key)}
              className={`flex w-full cursor-pointer appearance-none items-center gap-2.5 rounded-lg border-0 py-2 pr-2.5 text-left transition-colors ${
                item.kind === "router" ? "pl-7" : "pl-2.5"
              } ${
                item.key === selected?.key
                  ? "bg-[var(--surface-raised)]"
                  : "bg-transparent hover:bg-[color-mix(in_srgb,var(--surface-raised)_55%,transparent)]"
              }`}
            >
              {item.kind === "dish" ? (
                <DishIcon className={item.status !== "online" ? "opacity-40" : undefined} />
              ) : (
                <RouterIcon className={item.status !== "online" ? "opacity-40" : undefined} />
              )}
              <span className='flex-1 truncate text-[13px] font-semibold'>{item.name}</span>
              <StatusDot status={item.status} />
            </button>
          </li>
        ))}
      </ul>
      {selected && <DeviceDetail item={selected} />}
    </div>
  );
}

export function AccountPanel() {
  const { data, status, reload } = useCloudAccount(true);

  if (status === "not-connected") {
    return <ConnectAccount onConnected={reload} />;
  }
  if (status === "error") {
    return (
      <Callout tone='error' className='mt-2.5'>
        Couldn’t reach your Starlink account. Check your internet and try again.
      </Callout>
    );
  }
  if (status === "loading" || !data) {
    return <Loading message='Loading your Starlink account…' size={26} stacked />;
  }

  const identity = data.identity;
  const line = data.serviceLine?.content;
  const address = line?.serviceAddress;
  const sub = line?.subscription;
  const terminals = line?.userTerminals ?? [];

  return (
    <div className='flex flex-col gap-3.5 pb-2'>
      <Card
        title='Profile'
        meta={
          <button
            type='button'
            // Reload either way: the local session file is cleared before the
            // request can fail, so a swallowed error must not leave the panel
            // showing a connected account that no longer is.
            onClick={() => void disconnectCloud().finally(reload)}
            className='card-meta cursor-pointer border-0 bg-transparent underline underline-offset-2 hover:text-foreground'
          >
            Disconnect
          </button>
        }
      >
        <div className='grid grid-cols-3 gap-4 max-[820px]:grid-cols-1 '>
          <Field label='Name'>{identity?.name ?? "—"}</Field>
          <Field label='Email'>{identity?.email ?? "—"}</Field>
          <Field label='Account'>
            <span className='mono-value'>
              {identity?.accountId ?? line?.accountReferenceId ?? "—"}
            </span>
          </Field>
        </div>
      </Card>

      <div className='grid grid-cols-2 gap-3.5 max-[820px]:grid-cols-1'>
        <Card title='Service plan'>
          <div className='flex flex-col gap-4'>
            <Field label='Plan'>
              <span className='inline-flex items-center gap-2'>
                {sub?.productDescription ?? "—"}
                {sub?.active && (
                  <span
                    className='rounded-full border px-2 py-0.5 text-[11px] font-semibold'
                    style={{ color: "var(--status-good)", borderColor: "var(--status-good)" }}
                  >
                    Active
                  </span>
                )}
              </span>
            </Field>
            <Field label='Service line'>
              <span className='mono-value'>{line?.serviceLineNumber ?? "—"}</span>
            </Field>
            <Field label='Active since'>
              {sub?.startDate ? new Date(sub.startDate).toLocaleDateString() : "—"}
            </Field>
          </div>
        </Card>

        <Card title='Service location'>
          <div className='flex flex-col gap-4'>
            <Field label='Address'>
              {address?.formattedAddress ?? `${address?.locality ?? ""}, ${address?.region ?? ""}`}
            </Field>
            {address?.geoLocation?.latitude != null && (
              <Field label='Coordinates'>
                <span className='mono-value'>
                  {address.geoLocation.latitude.toFixed(4)},{" "}
                  {address.geoLocation.longitude?.toFixed(4)}
                </span>
              </Field>
            )}
          </div>
        </Card>
      </div>

      <Card
        title='Devices'
        meta={
          <span className='text-[12px] font-medium text-muted-foreground'>
            {terminals.length} terminal{terminals.length === 1 ? "" : "s"}
          </span>
        }
      >
        <DevicesSection terminals={terminals} deviceTelemetry={data.deviceTelemetry ?? {}} />
      </Card>
    </div>
  );
}
