import { describe, expect, it } from "vitest";
import { deviceLabel, formatSpan, relativeTime } from "./alertFormat";

describe("formatSpan", () => {
  it("never reports a zero-length episode", () => {
    // An alert that fired and cleared inside the same second still happened;
    // "0s" reads as a glitch rather than a very short episode.
    expect(formatSpan(1000, 1000)).toBe("1s");
    expect(formatSpan(1000, 1400)).toBe("1s");
  });

  it("counts seconds under a minute", () => {
    expect(formatSpan(0, 45_000)).toBe("45s");
  });

  it("counts whole minutes under an hour", () => {
    expect(formatSpan(0, 5 * 60_000)).toBe("5m");
  });

  it("splits hours and minutes past an hour", () => {
    expect(formatSpan(0, (2 * 60 + 30) * 60_000)).toBe("2h 30m");
    // The hour part floors, so the minute remainder can never read as 60.
    expect(formatSpan(0, 119 * 60_000)).toBe("1h 59m");
  });
});

describe("relativeTime", () => {
  const now = 1_000_000_000_000;

  it("says 'just now' inside the first minute", () => {
    expect(relativeTime(now - 30_000, now)).toBe("just now");
  });

  it("steps through minutes, hours and days", () => {
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
  });

  it("never reports a future timestamp as negative", () => {
    // Clock skew between the historian and the browser can hand us an onset
    // slightly in the future; it must not render as "-1m ago".
    expect(relativeTime(now + 5_000, now)).toBe("just now");
  });
});

describe("deviceLabel", () => {
  it("names both devices, and calls anything else System", () => {
    expect(deviceLabel("dish")).toBe("Dish");
    expect(deviceLabel("router")).toBe("Router");
    // Alerts the dashboard raises itself (historian down, say) rather than
    // either device reporting them.
    expect(deviceLabel("system")).toBe("System");
  });
});
