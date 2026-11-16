export function solarAtmosphere(latitude: number, longitude: number, time: Date) {
  const rad = Math.PI / 180;
  const days = time.getTime() / 86400000 - 10957.5;
  const meanLongitude = (280.46 + 0.9856474 * days) * rad;
  const anomaly = (357.528 + 0.9856003 * days) * rad;
  const ecliptic = meanLongitude + (1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * rad;
  const obliquity = (23.439 - 0.0000004 * days) * rad;
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(ecliptic), Math.cos(ecliptic));
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(ecliptic));
  const hourAngle = (280.46061837 + 360.98564736629 * days + longitude) * rad - rightAscension;
  const elevation =
    Math.asin(
      Math.sin(latitude * rad) * Math.sin(declination) +
        Math.cos(latitude * rad) * Math.cos(declination) * Math.cos(hourAngle),
    ) / rad;
  const brightness = Math.max(0, Math.min(1, (elevation + 12) / 22));
  const smooth = brightness * brightness * (3 - 2 * brightness);
  const fog: [number, number, number] = [0.34 * smooth, 0.62 * smooth, 0.86 * smooth];
  return {
    elevation,
    fog,
    stars: elevation < -6,
    phase: elevation >= -0.833 ? "Siang" : elevation >= -12 ? "Senja / fajar" : "Malam",
  };
}
