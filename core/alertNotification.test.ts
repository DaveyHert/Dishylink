import { describe, expect, it } from "vitest";
import { AlertEngine } from "./alertEngine";
import {
  NotificationThrottle,
  describeTransition,
  notificationsProblem,
  notificationsRequested,
} from "./alertNotification";
import { dataLimitAlertSpec } from "./dataMeterAlert";

const NOW = 1_700_000_000_000;

/** Drive the engine to produce a real transition rather than hand-building one,
 *  so the wording is tested against what a host actually receives. */
function transitionFor(dishAlerts: Record<string, boolean>, atMs = NOW) {
  const engine = new AlertEngine();
  return engine.update({ dish: { alerts: dishAlerts, atMs } })[0]!;
}

describe("describeTransition", () => {
  it("words an onset with the alert's firing message", () => {
    const notification = describeTransition(transitionFor({ dishWaterDetected: true }));
    expect(notification).toMatchObject({
      title: "Dish alert",
      body: "Water detected inside the dish",
      severity: "critical",
    });
  });

  it("words a clear with the alert's ok message", () => {
    const engine = new AlertEngine();
    engine.update({ dish: { alerts: { dishWaterDetected: true }, atMs: NOW } });
    const [cleared] = engine.update({ dish: { alerts: {}, atMs: NOW + 1_000 } });
    expect(describeTransition(cleared!)).toMatchObject({
      title: "Dish alert cleared",
      body: "No water inside the dish",
    });
  });

  it("stays silent on a clear the alert asked not to announce", () => {
    const spec = dataLimitAlertSpec(
      {
        clientKey: "42",
        allocationBytes: 10_000_000_000,
        autoPause: true,
        cycle: { kind: "monthly", day: 1 },
        anchorRx: 0,
        anchorTx: 0,
        observedRx: 0,
        observedTx: 0,
        periodStartMs: NOW,
        periodEndMs: NOW + 86_400_000,
        actedThisCycle: false,
        createdMs: NOW,
      },
      "iPhone",
    );
    const cleared = { kind: "cleared", source: "system", key: spec.key, atMs: NOW, spec } as const;

    // The onset is worth interrupting someone with; its retirement a minute later
    // reports nothing new, and would claim a still-capped device is within its
    // allowance.
    expect(describeTransition({ ...cleared, kind: "fired" })).not.toBeNull();
    expect(describeTransition(cleared)).toBeNull();
  });

  it("gives the onset and the clear different throttle keys", () => {
    const engine = new AlertEngine();
    const [fired] = engine.update({ dish: { alerts: { dishWaterDetected: true }, atMs: NOW } });
    const [cleared] = engine.update({ dish: { alerts: {}, atMs: NOW + 1_000 } });
    expect(describeTransition(fired!)?.key).not.toBe(describeTransition(cleared!)?.key);
  });

  it("stays silent for an alert not worth interrupting anyone for", () => {
    // isHeating is advisory and carries no `notify` flag.
    expect(describeTransition(transitionFor({ isHeating: true }))).toBeNull();
  });

  it("names the app, not a device, for conditions it observes itself", () => {
    const engine = new AlertEngine();
    const [transition] = engine.update({ dish: { alerts: null, atMs: NOW } });
    expect(describeTransition(transition!)).toMatchObject({
      title: "Dishylink alert",
      body: "Dish isn’t answering",
    });
  });
});

describe("NotificationThrottle", () => {
  it("allows the first send of a key", () => {
    expect(new NotificationThrottle().allow("a", NOW)).toBe(true);
  });

  it("suppresses a repeat inside the window", () => {
    const throttle = new NotificationThrottle(60_000);
    throttle.allow("a", NOW);
    expect(throttle.allow("a", NOW + 59_999)).toBe(false);
  });

  it("allows a repeat once the window has passed", () => {
    const throttle = new NotificationThrottle(60_000);
    throttle.allow("a", NOW);
    expect(throttle.allow("a", NOW + 60_000)).toBe(true);
  });

  it("throttles each key independently", () => {
    const throttle = new NotificationThrottle(60_000);
    throttle.allow("a", NOW);
    expect(throttle.allow("b", NOW)).toBe(true);
  });

  it("does not record a send it refused", () => {
    // A refusal must not push the window forward, or a steadily flapping alert
    // would be silenced indefinitely rather than reported once a minute.
    const throttle = new NotificationThrottle(60_000);
    throttle.allow("a", NOW);
    throttle.allow("a", NOW + 30_000);
    expect(throttle.allow("a", NOW + 60_000)).toBe(true);
  });
});

describe("notificationsRequested", () => {
  it("reads as on from the request alone, so an undeliverable channel stays switchable off", () => {
    expect(notificationsRequested({ wanted: true, deliverable: false, reason: "no" })).toBe(true);
  });

  it("reads as off before the host has reported, rather than guessing on", () => {
    expect(notificationsRequested({ wanted: null, deliverable: true })).toBe(false);
  });

  it("reads as off when notifications were declined", () => {
    expect(notificationsRequested({ wanted: false, deliverable: true })).toBe(false);
  });
});

describe("notificationsProblem", () => {
  it("explains a request that cannot be delivered", () => {
    expect(notificationsProblem({ wanted: true, deliverable: false, reason: "unsigned" })).toBe(
      "unsigned",
    );
  });

  it("stays quiet while notifications are arriving", () => {
    expect(notificationsProblem({ wanted: true, deliverable: true })).toBeNull();
  });

  it("stays quiet about a broken channel nobody asked to use", () => {
    expect(
      notificationsProblem({ wanted: false, deliverable: false, reason: "unsigned" }),
    ).toBeNull();
  });
});
