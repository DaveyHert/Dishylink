import type { ImageMetadata } from "astro";

// Eager and glob-literal so Vite can still trace every file at build time —
// `<Image>` needs real imports to emit derivatives and intrinsic dimensions,
// which a path assembled at runtime would not give it.
const screenshotFiles = import.meta.glob<{ default: ImageMetadata }>("../assets/shots/*.png", {
  eager: true,
});

function screenshotFile(name: string): ImageMetadata {
  const file = screenshotFiles[`../assets/shots/${name}.png`];
  if (!file) throw new Error(`No screenshot named ${name}.png in assets/shots`);
  return file.default;
}

export interface SectionMedia {
  light: ImageMetadata;
  /** Omitted for surfaces the app only draws dark, which then show that capture in both themes. */
  dark?: ImageMetadata;
  alt: string;
  widths?: number[];
  sizes?: string;
  /** A file in public/. Set means the still is a poster the visitor can play. */
  video?: string;
}

type Sizing = { widths?: number[]; sizes?: string };

/** Pairs `<name>-light.png` with `<name>-dark.png`, the convention every screenshot follows. */
function screenshot(name: string, alt: string, sizing: Sizing = {}): SectionMedia {
  return {
    light: screenshotFile(`${name}-light`),
    dark: screenshotFile(`${name}-dark`),
    alt,
    ...sizing,
  };
}

/** A still that plays `src` on click. The video is never fetched until then. */
function video(poster: string, src: string, alt: string, sizing: Sizing = {}): SectionMedia {
  return { light: screenshotFile(poster), alt, video: src, ...sizing };
}

export interface SectionContent {
  label: string;
  id?: string;
  tint?: boolean;
  backdrop?: "halo" | "spotlight";
  /** Where the media sits relative to the prose; also decides centring. */
  layout: "media-right" | "media-left" | "two-media" | "full-media";
  title: string;
  body: string[];
  bullets?: [term: string, detail: string][];
  media: SectionMedia[];
}

const halfWidthSizing = { widths: [720, 1200, 1800], sizes: "(max-width: 1024px) 100vw, 660px" };

export const sections: SectionContent[] = [
  {
    label: "Alignment",
    tint: true,
    layout: "media-right",
    title: "Dish alignment you can act on.",
    body: [
      "The dish knows the rotation and tilt it wants and where it's actually pointed. Dishylink lets you see the target rotation and tilt to accurately fine-tune your dish for the strongest possible signal. Its visualized so you can see at a glance whether it's aligned, and the exact nudge in degrees when it isn't.",
    ],
    media: [
      screenshot(
        "alignment",
        "Dishylink's alignment panel: rotation and tilt dials with orange needles inside their tolerance wedges, plus current rotation, boresight error, attitude uncertainty, satellites in view and the acceptable elevation range.",
        halfWidthSizing,
      ),
    ],
  },
  {
    label: "Speed test",
    layout: "media-left",
    title: "Settle it with a real speed test",
    body: [
      "A full speed test built into the app, on demand, so you can see what the link can handle. It measures against Cloudflare, so the figure is honest rather than flattering.",
    ],
    bullets: [
      [
        "Download, upload and latency",
        "The three that matter, plus jitter and loss for the full picture of the link's health.",
      ],
      [
        "Two ways to watch it",
        "A Starlink-styled animation or a traditional gauge — same numbers, your choice of readout.",
      ],
      [
        "Run it again anytime",
        "One tap re-runs the test, so you can watch how the link holds up minute to minute.",
      ],
    ],
    media: [
      screenshot(
        "speedtest",
        "Dishylink's speed test: 267.1 Mbps down, 37.6 Mbps up and 20 ms latency, with jitter and packet loss beneath, a Starlink-styled dish animation, and a run-again button. Measured against Cloudflare.",
        halfWidthSizing,
      ),
    ],
  },
  {
    label: "Network & Nodes",
    backdrop: "halo",
    layout: "two-media",
    title: "See every connected client device on your network",
    body: [
      "Dishylink lists every client the router can see, live and refreshed every five seconds — each named, tagged with its vendor and the band it's on. Open one for the full picture: status, signal strength and signal-to-noise, which node it's joined to, and its own live download and upload history.",
    ],
    media: [
      screenshot(
        "network-list",
        "Dishylink's Network panel: twelve devices live from the router, refreshed every five seconds — a MacBook Pro, PS5, iPhones, a HomePod, a Hisense TV and several Govee lamps — each with its vendor and WiFi band, alongside a Nodes tab.",
      ),
      screenshot(
        "network-detail",
        "A single device's detail in Dishylink: status, role, the router it's connected to, manufacturer, connection band, signal strength and signal-to-noise, above its own live download and upload throughput charts.",
      ),
    ],
  },
  {
    label: "Data usage",
    id: "data",
    layout: "two-media",
    title: "Granular data usage visibility.",
    body: [
      "Every byte through the dish, split by download and upload, over any window from an hour to a month. Per-device totals name what is actually spending it — each client identified by name, vendor and type, with its own split for the billing month.",
    ],
    media: [
      screenshot(
        "data-usage",
        "Dishylink's data usage panel on the Local Session tab: 13.1 GB down, 2.4 GB up and 15.5 GB total, stacked hourly bars across twelve hours, and a Devices Usage list showing a MacBook Pro at 819.22 GB, two iPhones and other clients with their download and upload split for August 2026.",
      ),
      screenshot(
        "data-usage-billing",
        "The same panel on the Starlink billing tab: 3.05 TB of residential data against a 100 TB unlimited allowance, with daily bars across the March 6 to April 6 billing cycle and month tabs from February to August.",
      ),
    ],
  },
  {
    label: "Power usage",
    id: "power",
    layout: "media-right",
    title: "Complete energy usage visibility.",
    body: [
      "Monitor your terminal's real-time power draw and historical energy breakdowns with high-fidelity and real-time graphs. Your terminal only remembers the last few minutes, so Dishylink records around the clock and keeps the total.",
      "Every total says how much of its period was actually recorded, so a gap never quietly pads the number.",
    ],
    media: [
      screenshot(
        "power",
        "Dishylink's power draw panel: 59 W average and 46 W current, a live 15-minute draw chart peaking near 90 W, 0.015 kWh used over that window, and 0.421 kWh of total energy split into hourly bars across the last twelve hours.",
        { sizes: "(max-width: 1024px) 100vw, 620px" },
      ),
    ],
  },
  {
    label: "Latency Analytics",
    tint: true,
    layout: "media-left",
    title: "See whether the lag is Starlink or your router",
    body: [
      "The dish and the router each time their own round trip to the internet. Dishylink reads both and charts them together, so a spike shows whether the delay is coming from Starlink or from your router network.",
    ],
    media: [
      screenshot(
        "latency",
        "Dishylink's latency detail: 30 ms average and 23 ms current, a 15-minute chart comparing Starlink and router latency, latency distribution histograms for each, and a plain-English note explaining what latency is.",
        halfWidthSizing,
      ),
    ],
  },
  {
    label: "Alerts & Event Log",
    id: "alerts",
    layout: "full-media",
    title: "Know the moment something breaks",
    body: [
      "Dishylink raises an alert the moment the dish or router stops answering, overheats or runs into weather, and clears it once the problem passes. Every event lands in a log you can scroll back through, and a live status list shows the health of each component as it changes.",
    ],
    media: [
      screenshot(
        "alerts",
        "Dishylink's alerting: active alerts for a dish and router that have stopped answering and for weather interference; an events and outages log listing WiFi band switches, Starlink boots, a ping interruption and a public IP change; an alert history showing how long each fault lasted and when it cleared; and per-component status lists for the dish and router covering temperature, water ingress, motors, Ethernet speed and mesh health.",
        { widths: [720, 1200, 1800, 2400], sizes: "(max-width: 1200px) 100vw, 1200px" },
      ),
    ],
  },
  {
    label: "Control settings",
    id: "controls",
    backdrop: "spotlight",
    layout: "two-media",
    title: "Direct control of your Starlink hardware.",
    body: [
      "Manage configuration for your dish and local network. Control routine maintenance, software updates, and power management with ease on supported firmware versions.",
      "Custom DNS, bypass mode and content filtering are deliberately left out — a bad write can take your WiFi down until a physical reset.",
    ],
    media: [
      screenshot(
        "settings-starlink",
        "Dishylink's settings on the Starlink tab: snow melt, sleep schedule, a software update window set to overnight around 3 AM, firmware deferral, a debug data copy button, and maintenance actions to reset the obstruction map or reboot the dish.",
      ),
      screenshot(
        "settings-router",
        "The Router tab of the same settings panel: the StarL X network with its 2 GHz, 5 GHz and 5 GHz hi bands, a trusted Mesh 1 node, router firmware and country, and a reboot router action.",
      ),
    ],
  },
  {
    label: "OS Notifications & Live Throughput",
    layout: "media-right",
    title: "Live throughput and notifications that work with the app closed",
    body: [
      "Turn live throughput on and the live download and upload rate sits in the macOS menu bar, or in a floating widget you can park anywhere on Windows. Turn notifications on and alerts come from macOS, Windows or your browser when app is closed — one when something breaks, another when it clears.",
    ],
    media: [
      screenshot(
        "os-notifications",
        "Dishylink in macOS: the live down and up rate in the menu bar, and Notification Center stacked with Dishylink alerts — the dish and router not answering, pings to the Starlink network failing, and the matching cleared notifications as each recovered.",
        halfWidthSizing,
      ),
    ],
  },
  {
    label: "Satellite & Obstruction Map",
    id: "satellite",
    layout: "full-media",
    title: "Live satellite constellation and obstruction time-lapse",
    body: [
      "See every Starlink satellite overhead, and which one your dish is communicating with, in a real-time interactive 3D scene — plus exactly where obstructions are blocking your dish's sky view and signal.",
    ],
    media: [
      video(
        "satellite",
        "/satellite-view.mp4",
        "Dishylink's live satellite view: Starlink satellites drifting across the sky above a 3D obstruction dome, with the serving satellite beamed to the dish, a panel reading 0.17% sky obstructed over 4.1 hours and 258 satellites overhead, and an obstruction time-lapse scrubber.",
      ),
    ],
  },
];
