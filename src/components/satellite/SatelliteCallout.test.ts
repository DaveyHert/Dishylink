import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SatelliteCallout } from "./SatelliteCallout";
import type { SatelliteSky } from "../../lib/satellites";

const sky: SatelliteSky = {
  name: "STARLINK-TEST [DTC]",
  azimuthDeg: 45,
  elevationDeg: 30,
  rangeKm: 600,
};

function render(overrides: Partial<SatelliteSky> = {}) {
  return renderToStaticMarkup(
    createElement(SatelliteCallout, {
      selected: { sky: { ...sky, ...overrides }, isServing: false },
      onClose: () => {},
    }),
  );
}

describe("SatelliteCallout metadata", () => {
  it("shows version and string NORAD while preserving name and DTC badge", () => {
    const html = render({ noradId: "58705", hardwareVersion: "V2 Mini DTC" });
    expect(html).toContain("STARLINK-TEST");
    expect(html).toContain(">DTC<");
    expect(html).toContain(">version<");
    expect(html).toContain(">V2 Mini DTC<");
    expect(html).toContain(">NORAD<");
    expect(html).toContain(">58705<");
  });

  it("shows Unknown without guessed metadata", () => {
    expect(render().match(/>Unknown</g)).toHaveLength(2);
    expect(render({ noradId: "00123" })).toContain(">00123<");
  });
});
