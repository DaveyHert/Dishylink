type Color = [number, number, number];
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => {
  const x = clamp(value);
  return x * x * (3 - 2 * x);
};
const mix = (a: Color, b: Color, amount: number): Color =>
  a.map((value, i) => value + (b[i] - value) * amount) as Color;

/** Artistic sky exposure, not radiometry or directional terrain lighting. No trig. */
export function skyLighting(sunElevation: number, moonElevation: number, illumination: number) {
  const daylight = smooth((sunElevation + 6) / 66);
  const twilight = smooth((sunElevation + 18) / 18) * (1 - smooth(sunElevation / 12));
  const moonContribution =
    0.08 *
    smooth(moonElevation / 60) *
    clamp(illumination) *
    (1 - smooth((sunElevation + 12) / 12));
  const night: Color = [
    0.004 + moonContribution * 0.4,
    0.006 + moonContribution * 0.65,
    0.012 + moonContribution,
  ];
  const fog = mix(mix(night, [0.19, 0.09, 0.075], twilight), [0.34, 0.62, 0.86], daylight);
  const starIntensity = (1 - smooth((sunElevation + 18) / 18)) * (1 - moonContribution * 4);
  return {
    fog,
    stars: starIntensity > 0,
    starIntensity,
    moonContribution,
    brightness: fog[0] * 0.2126 + fog[1] * 0.7152 + fog[2] * 0.0722,
    phase: sunElevation >= -0.833 ? "Siang" : sunElevation >= -18 ? "Senja / fajar" : "Malam",
  };
}
