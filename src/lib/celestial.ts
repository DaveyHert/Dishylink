const RAD = Math.PI / 180;
const sin = (degrees: number) => Math.sin(degrees * RAD);
const cos = (degrees: number) => Math.cos(degrees * RAD);
const wrap = (degrees: number) => ((degrees % 360) + 360) % 360;
type Vector = [number, number, number];

export interface LookAngles {
  azimuth: number;
  elevation: number;
}

/** Geometric center, north=0°, east=90°. Observer on spherical Earth, sea level. */
export function horizontal(vector: Vector, latitude: number, sidereal: number): LookAngles {
  const [x, y, z] = vector;
  const meridian = x * cos(sidereal) + y * sin(sidereal);
  const east = -x * sin(sidereal) + y * cos(sidereal);
  const north = -meridian * sin(latitude) + z * cos(latitude);
  const up = meridian * cos(latitude) + z * sin(latitude);
  return {
    azimuth: wrap(Math.atan2(east, north) / RAD),
    elevation: Math.atan2(up, Math.hypot(east, north)) / RAD,
  };
}

function orbit(anomaly: number, eccentricity: number, axis: number) {
  const m = wrap(anomaly) * RAD;
  let e = m;
  for (let i = 0; i < 8; i++)
    e -= (e - eccentricity * Math.sin(e) - m) / (1 - eccentricity * Math.cos(e));
  const x = axis * (Math.cos(e) - eccentricity);
  const y = axis * Math.sqrt(1 - eccentricity ** 2) * Math.sin(e);
  return { radius: Math.hypot(x, y), anomaly: Math.atan2(y, x) / RAD };
}

/** Schlyter low-precision elements + three largest longitude / largest latitude terms.
 * https://stjarnhimlen.se/comp/ppcomp.html sections 4–13, 15.
 * Not a precision ephemeris: omitted lunar terms, refraction, TT−UTC, nutation,
 * aberration, Earth flattening and observer height. See docs/celestial-sky.md.
 */
export function celestialPositions(latitude: number, longitude: number, time: Date) {
  if (
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90 ||
    !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180 ||
    !Number.isFinite(time.getTime())
  ) {
    throw new RangeError("Invalid location or UTC time");
  }
  const d = time.getTime() / 86400000 - 10956;
  const obliquity = 23.4393 - 3.563e-7 * d;
  const sunM = 356.047 + 0.9856002585 * d;
  const sunW = 282.9404 + 4.70935e-5 * d;
  const sunOrbit = orbit(sunM, 0.016709 - 1.151e-9 * d, 1);
  const sunLongitude = sunOrbit.anomaly + sunW;
  const node = 125.1228 - 0.0529538083 * d;
  const moonW = 318.0634 + 0.1643573223 * d;
  const moonM = 115.3654 + 13.0649929509 * d;
  const moonOrbit = orbit(moonM, 0.0549, 60.2666);
  const argument = moonOrbit.anomaly + moonW;
  const x = cos(node) * cos(argument) - sin(node) * sin(argument) * cos(5.1454);
  const y = sin(node) * cos(argument) + cos(node) * sin(argument) * cos(5.1454);
  const z = sin(argument) * sin(5.1454);
  const elongation = moonM + moonW + node - (sunM + sunW);
  const latitudeArgument = moonM + moonW;
  const moonLongitude =
    Math.atan2(y, x) / RAD -
    1.274 * sin(moonM - 2 * elongation) +
    0.658 * sin(2 * elongation) -
    0.186 * sin(sunM);
  const moonLatitude =
    Math.atan2(z, Math.hypot(x, y)) / RAD - 0.173 * sin(latitudeArgument - 2 * elongation);
  const moonRadius =
    moonOrbit.radius - 0.58 * cos(moonM - 2 * elongation) - 0.46 * cos(2 * elongation);
  const equatorial = (lon: number, lat: number, radius: number): Vector => {
    const ey = radius * sin(lon) * cos(lat);
    const ez = radius * sin(lat);
    return [
      radius * cos(lon) * cos(lat),
      ey * cos(obliquity) - ez * sin(obliquity),
      ey * sin(obliquity) + ez * cos(obliquity),
    ];
  };
  const sidereal = wrap(280.46061837 + 360.98564736629 * (d - 1.5) + longitude);
  const moonVector = equatorial(moonLongitude, moonLatitude, moonRadius);
  // Subtract observer in Earth radii before ENU rotation: lunar parallax ~1° matters.
  const observer: Vector = [
    cos(latitude) * cos(sidereal),
    cos(latitude) * sin(sidereal),
    sin(latitude),
  ];
  const topocentric = moonVector.map((value, i) => value - observer[i]) as Vector;
  const cycle = wrap(moonLongitude - sunLongitude) / 360;
  const illumination = (1 - cos(moonLongitude - sunLongitude) * cos(moonLatitude)) / 2;
  const phase =
    illumination < 0.01
      ? "Bulan baru"
      : illumination > 0.99
        ? "Purnama"
        : cycle < 0.5
          ? "Membesar"
          : "Mengecil";
  return {
    sun: horizontal(equatorial(sunLongitude, 0, sunOrbit.radius), latitude, sidereal),
    moon: {
      ...horizontal(topocentric, latitude, sidereal),
      illumination,
      phase,
      cycle,
      geocentricElevation: horizontal(moonVector, latitude, sidereal).elevation,
    },
  };
}
