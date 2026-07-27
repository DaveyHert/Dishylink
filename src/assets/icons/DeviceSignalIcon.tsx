// The leading glyph on a device row: wifi arcs scaled to signal quality, or an
// Ethernet port for a wired client (which has no RSSI to show as arcs).

import type { WifiClientJson } from "@core/dishClient";
import type { SignalQuality } from "../../components/network/networkFormat";

/** Concentric wifi-arc glyph (like the official app): white/ink arcs, with the
 *  weaker arcs dimmed by signal quality (`bars` 1–4 → dot + up to 3 arcs). */
function WifiArcIcon({ bars }: { bars: number }) {
  // inner → outer arc lights at bars ≥ 2/3/4; the base dot is the weakest level.
  const arcs: { d: string; litAt: number }[] = [
    { d: "M8.5 16.1a6 6 0 0 1 7 0", litAt: 2 },
    { d: "M5 12.5a11 11 0 0 1 14 0", litAt: 3 },
    { d: "M1.4 9a16 16 0 0 1 21.2 0", litAt: 4 },
  ];
  return (
    <svg width='20' height='16' viewBox='0 0 24 20' className='block' aria-hidden='true'>
      {arcs.map((arc) => (
        <path
          key={arc.litAt}
          d={arc.d}
          fill='none'
          stroke='var(--ink)'
          strokeWidth={2}
          strokeLinecap='round'
          opacity={bars >= arc.litAt ? 1 : 0.28}
        />
      ))}
      <circle cx={12} cy={19.5} r={1.3} fill='var(--ink)' opacity={bars >= 1 ? 1 : 0.28} />
    </svg>
  );
}

/** Ethernet-port glyph for wired clients (no RSSI to show as arcs). */
function WiredIcon() {
  return (
    <svg width='20' height='16' viewBox='0 0 24 20' className='block' aria-hidden='true'>
      <rect
        x={4}
        y={5}
        width={16}
        height={9}
        rx={1.5}
        fill='none'
        stroke='var(--ink)'
        strokeWidth={2}
      />
      {[8, 12, 16].map((x) => (
        <line
          key={x}
          x1={x}
          y1={14}
          x2={x}
          y2={17}
          stroke='var(--ink)'
          strokeWidth={2}
          strokeLinecap='round'
        />
      ))}
    </svg>
  );
}

/** Picks the wired glyph for Ethernet, else the wifi-arc glyph. */
export function DeviceSignalIcon({
  client,
  quality,
}: {
  client: WifiClientJson;
  quality: SignalQuality | null;
}) {
  if (client.iface === "ETH") return <WiredIcon />;
  return <WifiArcIcon bars={quality?.bars ?? 0} />;
}
