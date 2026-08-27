// The account's device browser: a picker on the left (dishes with their routers
// indented under them), the selected device's spec panel on the right.

import { useMemo, useState, type ReactNode } from "react";
import {
  connectionLabel,
  formatUptime,
  routerHardwareName,
  type CloudTerminal,
  type DeviceTelemetry,
  type DishTelemetry,
  type RouterTelemetry,
} from "../../lib/starlinkCloud";
import { DishIcon } from "../../assets/icons/DishIcon";
import { RouterIcon } from "../../assets/icons/RouterIcon";
import { Field, StatusDot } from "./accountChrome";
import { buildDeviceList, type DeviceItem } from "./deviceList";

function lastUpdated(tel: DeviceTelemetry | undefined): string {
  return tel ? new Date(tel.timestampMs).toLocaleString() : "—";
}

/** Dish or router glyph, dimmed when the device isn't online. */
function DeviceIcon({ item }: { item: DeviceItem }) {
  const className = item.status !== "online" ? "opacity-40" : undefined;
  return item.kind === "dish" ? (
    <DishIcon className={className} />
  ) : (
    <RouterIcon className={className} />
  );
}

/** The fields each kind of device exposes. Dish and router share no columns, so
 *  the panel is built per kind rather than merged into one optional-heavy list. */
function fieldsFor(item: DeviceItem): { label: string; value: ReactNode; mono?: boolean }[] {
  if (item.kind === "dish") {
    const t = item.terminal!;
    const tel = item.tel as DishTelemetry | undefined;
    return [
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
    ];
  }
  const r = item.router!;
  const tel = item.tel as RouterTelemetry | undefined;
  return [
    { label: "Router ID", value: r.routerId ?? "—", mono: true },
    { label: "Hardware version", value: routerHardwareName(tel?.hardwareVersion) },
    { label: "Software version", value: tel?.softwareVersion ?? "—", mono: true },
    { label: "Clients", value: tel?.clients != null ? String(tel.clients) : "—" },
    { label: "Uptime", value: formatUptime(tel?.uptimeS) },
    { label: "Connection to Starlink", value: connectionLabel(tel?.hops) },
    { label: "Bypassed", value: tel ? (tel.isBypassed ? "Yes" : "No") : "—" },
    { label: "Last updated", value: lastUpdated(tel) },
  ];
}

function DeviceDetail({ item }: { item: DeviceItem }) {
  return (
    <div className='rounded-xl border border-border/70 p-4 bg-background/30'>
      <div className='mb-3 flex items-center gap-2.5'>
        <DeviceIcon item={item} />
        <span className='text-[15px] font-semibold'>{item.name}</span>
        <span className='ml-auto flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground'>
          <StatusDot status={item.status} />
          {item.status}
        </span>
      </div>
      <div className='grid grid-cols-2 gap-4 max-[520px]:grid-cols-1'>
        {fieldsFor(item).map((field) => (
          <Field key={field.label} label={field.label}>
            {field.mono ? <span className='mono-value break-all'>{field.value}</span> : field.value}
          </Field>
        ))}
      </div>
    </div>
  );
}

export function DevicesSection({
  terminals,
  deviceTelemetry,
  lanOnline,
}: {
  terminals: CloudTerminal[];
  deviceTelemetry: Record<string, DeviceTelemetry>;
  lanOnline: ReadonlySet<string>;
}) {
  const items = useMemo(
    () => buildDeviceList(terminals, deviceTelemetry, lanOnline),
    [terminals, deviceTelemetry, lanOnline],
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
                item.key === selected?.key ? "bg-fill-raised" : "bg-transparent hover:bg-fill-hover"
              }`}
            >
              <DeviceIcon item={item} />
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
