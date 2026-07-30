import { describe, expect, it } from "vitest";
import { AlertEngine } from "./alertEngine";
import { NotificationThrottle, describeTransition } from "./alertNotification";

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
      title: "DishyLink alert",
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
