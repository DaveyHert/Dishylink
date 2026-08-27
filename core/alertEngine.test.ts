import { describe, expect, it } from "vitest";
import { AlertEngine, type AlertObservation, type AlertTransition } from "./alertEngine";
import type { RouterPresence } from "./routerPresence";

const NOW = 1_700_000_000_000;

/** A cycle where both devices answered. */
function bothAnswered(
  dishAlerts: Record<string, boolean> = {},
  routerAlerts: Record<string, boolean> = {},
  atMs = NOW,
): AlertObservation {
  return { dish: { alerts: dishAlerts, atMs }, router: { alerts: routerAlerts, atMs } };
}

/** A cycle where the router said nothing and the dish explained why. */
function routerSilent(routerPresence: RouterPresence | undefined, atMs = NOW): AlertObservation {
  return {
    dish: { alerts: {}, routerPresence, atMs },
    router: { alerts: null, atMs },
  };
}

function keysOf(transitions: AlertTransition[]): string[] {
  return transitions.map((t) => `${t.kind}:${t.source}:${t.key}`);
}

describe("AlertEngine", () => {
  it("reports an alert the first time it is seen firing", () => {
    const engine = new AlertEngine();
    expect(keysOf(engine.update(bothAnswered({ thermalShutdown: true })))).toEqual([
      "fired:dish:thermalShutdown",
    ]);
  });

  it("stays quiet while the same alert keeps firing", () => {
    const engine = new AlertEngine();
    engine.update(bothAnswered({ thermalShutdown: true }));
    expect(engine.update(bothAnswered({ thermalShutdown: true }, {}, NOW + 5_000))).toEqual([]);
  });

  it("reports the clear when the flag drops", () => {
    const engine = new AlertEngine();
    engine.update(bothAnswered({ thermalShutdown: true }));
    expect(keysOf(engine.update(bothAnswered({}, {}, NOW + 5_000)))).toEqual([
      "cleared:dish:thermalShutdown",
    ]);
  });

  it("says nothing about a device it was never asked about", () => {
    // The browser learns about the recorder and nothing else; it must not
    // announce that a dish it never polled has gone silent.
    const engine = new AlertEngine();
    expect(engine.update({ system: { alerts: { historianDown: false }, atMs: NOW } })).toEqual([]);
  });

  it("raises unreachability when a device is asked and does not answer", () => {
    const engine = new AlertEngine();
    engine.update(bothAnswered());
    const transitions = engine.update({
      dish: { alerts: null, atMs: NOW + 5_000 },
      router: { alerts: {}, atMs: NOW + 5_000 },
    });
    expect(keysOf(transitions)).toEqual(["fired:system:dishUnreachable"]);
  });

  it("holds a device's alerts open while it is unreachable rather than clearing them", () => {
    const engine = new AlertEngine();
    engine.update(bothAnswered({ dishWaterDetected: true }));
    // The dish goes silent. Water was detected and has not been observed to stop.
    const transitions = engine.update({ dish: { alerts: null, atMs: NOW + 5_000 } });
    expect(keysOf(transitions)).toEqual(["fired:system:dishUnreachable"]);
    expect(engine.activeAlerts().map((a) => a.key)).toContain("dishWaterDetected");
  });

  it("clears unreachability once the device answers again", () => {
    const engine = new AlertEngine();
    engine.update({ dish: { alerts: null, atMs: NOW } });
    expect(keysOf(engine.update({ dish: { alerts: {}, atMs: NOW + 5_000 } }))).toEqual([
      "cleared:system:dishUnreachable",
    ]);
  });

  it("keeps each device's unreachability to itself", () => {
    const engine = new AlertEngine();
    engine.update({ router: { alerts: null, atMs: NOW } });
    // A dish reading must not clear the router's unreachability — both live
    // under "system", and only the router's own reading governs its key.
    engine.update({ dish: { alerts: {}, atMs: NOW + 1_000 } });
    expect(engine.activeAlerts().map((a) => a.key)).toEqual(["routerUnreachable"]);
  });

  it("does not clear a host-observed condition when a device reading arrives", () => {
    const engine = new AlertEngine();
    engine.update({ system: { alerts: { historianDown: true }, atMs: NOW } });
    engine.update(bothAnswered({}, {}, NOW + 1_000));
    expect(engine.activeAlerts().map((a) => a.key)).toContain("historianDown");
  });

  it("ignores the latched noEthernetLink flag when the link reports a speed", () => {
    const engine = new AlertEngine();
    const transitions = engine.update({
      dish: { alerts: { noEthernetLink: true }, ethSpeedMbps: 1000, atMs: NOW },
    });
    expect(transitions).toEqual([]);
  });

  it("still reports noEthernetLink when no speed is negotiated", () => {
    const engine = new AlertEngine();
    const transitions = engine.update({
      dish: { alerts: { noEthernetLink: true }, ethSpeedMbps: 0, atMs: NOW },
    });
    expect(keysOf(transitions)).toEqual(["fired:dish:noEthernetLink"]);
  });

  it("does not re-announce alerts restored as already firing", () => {
    const engine = new AlertEngine([{ source: "dish", key: "dishWaterDetected" }]);
    expect(engine.update(bothAnswered({ dishWaterDetected: true }))).toEqual([]);
  });

  it("closes a restored alert that cleared while the host was down", () => {
    const engine = new AlertEngine([{ source: "dish", key: "dishWaterDetected" }]);
    expect(keysOf(engine.update(bothAnswered()))).toEqual(["cleared:dish:dishWaterDetected"]);
  });

  it("stamps a transition with its own device's reading, not the cycle's start", () => {
    const engine = new AlertEngine();
    const dishAt = NOW;
    const routerAt = NOW + 4_000; // the router sat most of its timeout
    const transitions = engine.update({
      dish: { alerts: { thermalShutdown: true }, atMs: dishAt },
      router: { alerts: { poeFuseBlown: true }, atMs: routerAt },
    });
    expect(transitions.find((t) => t.key === "thermalShutdown")?.atMs).toBe(dishAt);
    expect(transitions.find((t) => t.key === "poeFuseBlown")?.atMs).toBe(routerAt);
  });

  it("carries wording and severity on every transition", () => {
    const engine = new AlertEngine();
    const [transition] = engine.update(bothAnswered({ thermalShutdown: true }));
    expect(transition?.spec.firing).toBe("Dish shut itself down to cool off");
    expect(transition?.spec.severity).toBe("critical");
    expect(transition?.spec.notify).toBe(true);
  });

  it("keeps the last known checks when a device stops answering", () => {
    const engine = new AlertEngine();
    engine.update(bothAnswered({ isHeating: true }));
    engine.update({ dish: { alerts: null, atMs: NOW + 5_000 } });
    expect(engine.statusList().find((check) => check.key === "isHeating")?.active).toBe(true);
  });
});

describe("AlertEngine and a router that is silent on purpose", () => {
  it("raises the unreachability when a router that should answer does not", () => {
    const engine = new AlertEngine();
    expect(keysOf(engine.update(routerSilent("present")))).toEqual([
      "fired:system:routerUnreachable",
    ]);
  });

  it("stays quiet when the dish reports the router bypassed", () => {
    // The user switched it off from this very app. Announcing it as a fault is
    // the app complaining about what it was told to do.
    const engine = new AlertEngine();
    expect(engine.update(routerSilent("bypassed"))).toEqual([]);
  });

  it("stays quiet when the kit has no router at all", () => {
    const engine = new AlertEngine();
    expect(engine.update(routerSilent("absent"))).toEqual([]);
  });

  it("closes an episode already open when bypass is switched on", () => {
    // The key stays in scope, so the pass that stops desiring it also ends it.
    const engine = new AlertEngine();
    engine.update(routerSilent("present"));
    expect(keysOf(engine.update(routerSilent("bypassed", NOW + 5_000)))).toEqual([
      "cleared:system:routerUnreachable",
    ]);
  });

  it("raises it again when the router is un-bypassed and still does not answer", () => {
    const engine = new AlertEngine();
    engine.update(routerSilent("bypassed"));
    expect(keysOf(engine.update(routerSilent("present", NOW + 5_000)))).toEqual([
      "fired:system:routerUnreachable",
    ]);
  });

  it("raises it when the dish has said nothing about routers at all", () => {
    // No evidence is not evidence of bypass.
    const engine = new AlertEngine();
    expect(keysOf(engine.update(routerSilent(undefined)))).toEqual([
      "fired:system:routerUnreachable",
    ]);
  });

  it("holds the last known presence across a silent dish poll", () => {
    // A dish that stops replying has no new opinion. Dropping to "unknown" would
    // resurrect the alert on the first dish timeout of a bypassed kit.
    const engine = new AlertEngine();
    engine.update(routerSilent("bypassed"));
    const dishAlsoSilent: AlertObservation = {
      dish: { alerts: null, atMs: NOW + 5_000 },
      router: { alerts: null, atMs: NOW + 5_000 },
    };
    expect(keysOf(engine.update(dishAlsoSilent))).toEqual(["fired:system:dishUnreachable"]);
  });

  it("still holds the router's own alerts while its silence is excused", () => {
    // Suppressing the unreachability must not also clear what the router last
    // reported: that would record a recovery nobody observed.
    const engine = new AlertEngine();
    engine.update({
      dish: { alerts: {}, routerPresence: "present", atMs: NOW },
      router: { alerts: { poeRouterOvercurrent: true }, atMs: NOW },
    });
    expect(engine.update(routerSilent("bypassed", NOW + 5_000))).toEqual([]);
    expect(engine.activeAlerts().map((a) => a.key)).toContain("poeRouterOvercurrent");
  });
});
