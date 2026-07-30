// The whole alerting path, end to end, with no host attached: readings in,
// notifications out. Each host adds only a transport at the far end, so a defect
// that survives this file is a defect in a transport, not in the alerting.
//
// The scenario is the one that started all of this: a dish stops answering while
// nobody has a window open, and has to reach the user anyway.

import { describe, expect, it } from "vitest";
import { AlertEngine } from "./alertEngine";
import { NotificationThrottle, describeTransition } from "./alertNotification";
import { OUTAGE_SAMPLE_RUN, isStarlinkOutage } from "./telemetry";

const START = 1_700_000_000_000;
const POLL_MS = 5_000;

/** Stands in for a host: engine, throttle, and whatever it would have shown. */
function recorder(alreadyFiring: { source: "dish" | "router" | "system"; key: string }[] = []) {
  const engine = new AlertEngine(alreadyFiring);
  const throttle = new NotificationThrottle();
  const shown: string[] = [];
  const recorded: string[] = [];

  /** One poll cycle. `answered` is what each device gave up, null for silence. */
  function poll(
    atMs: number,
    dish: Record<string, boolean> | null,
    router: Record<string, boolean> | null = {},
  ): void {
    for (const transition of engine.update({
      dish: { alerts: dish, atMs },
      router: { alerts: router, atMs },
    })) {
      // What the recorder writes down: every transition, notifiable or not.
      recorded.push(`${transition.kind}:${transition.source}:${transition.key}`);
      // What reaches the user: only the notifiable ones, only past the throttle.
      const notification = describeTransition(transition);
      if (notification && throttle.allow(notification.key, transition.atMs))
        shown.push(notification.body);
    }
  }

  return { poll, shown, recorded, engine };
}

describe("a dish going offline with no window open", () => {
  it("tells the user, then tells them it is back", () => {
    const host = recorder();
    host.poll(START, {});
    host.poll(START + POLL_MS, null, null); // the connection drops
    expect(host.shown).toEqual(["Dish isn’t answering", "Router isn’t answering"]);

    host.poll(START + 2 * POLL_MS, {}, {}); // and comes back
    expect(host.shown).toEqual([
      "Dish isn’t answering",
      "Router isn’t answering",
      "Dish is answering",
      "Router is answering",
    ]);
  });

  it("says it once, not once per poll, while the dish stays silent", () => {
    const host = recorder();
    host.poll(START, {});
    for (let i = 1; i <= 20; i += 1) host.poll(START + i * POLL_MS, null, null);
    // 20 polls over 100 seconds. The alert is one event, not twenty.
    expect(host.shown.filter((body) => body === "Dish isn’t answering")).toHaveLength(1);
    expect(host.recorded.filter((line) => line.endsWith("dishUnreachable"))).toHaveLength(1);
  });

  it("does not report the dish's own alerts as cleared while it is silent", () => {
    const host = recorder();
    host.poll(START, { dishWaterDetected: true });
    expect(host.shown).toEqual(["Water detected inside the dish"]);

    host.poll(START + POLL_MS, null);
    // Water has not been observed to stop — the dish simply stopped talking.
    // Announcing "no water inside the dish" here would be a lie.
    expect(host.shown).not.toContain("No water inside the dish");
    expect(host.engine.activeAlerts().map((a) => a.key)).toContain("dishWaterDetected");
  });

  it("survives a restart without announcing the same alert twice", () => {
    const first = recorder();
    first.poll(START, { dishWaterDetected: true });
    expect(first.shown).toHaveLength(1);

    // The app restarts. The recorder restores what its log says is still open.
    const second = recorder([{ source: "dish", key: "dishWaterDetected" }]);
    second.poll(START + 60 * POLL_MS, { dishWaterDetected: true });
    expect(second.shown).toEqual([]);
  });

  it("announces a recovery that happened while the app was down", () => {
    const host = recorder([{ source: "dish", key: "dishWaterDetected" }]);
    host.poll(START, {});
    expect(host.shown).toEqual(["No water inside the dish"]);
  });
});

describe("a Starlink outage while the dish itself is fine", () => {
  // The failure mode a dish-unreachable test never exercises: the hardware here
  // is answering perfectly and the satellite side is down. Neither device flags
  // it, so it only ever reaches anyone if something watches the drop rate.
  const dropping = Array.from({ length: OUTAGE_SAMPLE_RUN }, () => ({ dropRate: 1 }));
  const flowing = Array.from({ length: OUTAGE_SAMPLE_RUN }, () => ({ dropRate: 0 }));

  function pollWithSamples(
    host: ReturnType<typeof recorder>,
    atMs: number,
    samples: { dropRate: number }[],
  ): void {
    for (const transition of host.engine.update({
      dish: { alerts: {}, atMs },
      system: { alerts: { starlinkOutage: isStarlinkOutage(samples) }, atMs },
    })) {
      const notification = describeTransition(transition);
      if (notification) host.shown.push(notification.body);
    }
  }

  it("announces the outage and the recovery, with the dish still answering", () => {
    const host = recorder();
    pollWithSamples(host, START, flowing);
    expect(host.shown).toEqual([]);

    pollWithSamples(host, START + POLL_MS, dropping);
    expect(host.shown).toEqual([
      "The dish is reachable, but pings to the Starlink network are failing",
    ]);

    pollWithSamples(host, START + 2 * POLL_MS, flowing);
    expect(host.shown).toEqual([
      "The dish is reachable, but pings to the Starlink network are failing",
      "Pings to the Starlink network are succeeding again",
    ]);
  });

  it("does not call a single dropped second an outage", () => {
    // One dropped sample is ordinary — a satellite handover does it.
    const blip = [...flowing.slice(1), { dropRate: 1 }];
    expect(isStarlinkOutage(blip)).toBe(false);
    expect(isStarlinkOutage(dropping)).toBe(true);
  });

  it("waits for a full run before judging, rather than firing on a short window", () => {
    expect(isStarlinkOutage([{ dropRate: 1 }, { dropRate: 1 }])).toBe(false);
  });
});

describe("what reaches the user versus what is written down", () => {
  it("records an advisory alert without interrupting anyone over it", () => {
    const host = recorder();
    host.poll(START, { isHeating: true });
    expect(host.recorded).toEqual(["fired:dish:isHeating"]);
    expect(host.shown).toEqual([]);
  });

  it("ignores the dish's latched Ethernet flag, in the log as well as on screen", () => {
    const engine = new AlertEngine();
    // The firmware keeps noEthernetLink set for 40+ minutes after a flap while
    // reporting a working 1000 Mbps link in the same reply.
    const transitions = engine.update({
      dish: { alerts: { noEthernetLink: true }, ethSpeedMbps: 1000, atMs: START },
    });
    // Nothing recorded and nothing shown: history and the live panel agree,
    // which they did not when each decided for itself.
    expect(transitions).toEqual([]);
  });

  it("keeps a flapping alert to one notification a minute", () => {
    const host = recorder();
    // A link flapping on every 5s poll for two minutes.
    for (let i = 0; i < 24; i += 1)
      host.poll(START + i * POLL_MS, { thermalThrottle: i % 2 === 0 });
    const onsets = host.shown.filter((b) => b.startsWith("Dish is hot"));
    // Every crossing is recorded; the user hears about it roughly once a minute.
    expect(host.recorded.length).toBeGreaterThan(20);
    expect(onsets.length).toBeLessThanOrEqual(3);
    expect(onsets.length).toBeGreaterThan(0);
  });
});
