# Sun and Moon in the live satellite view

The full satellite view uses its resolved observer location (saved coordinates or
available dish location) and the browser's `Date.now()` clock. Astronomy and sky
exposure update immediately on coordinate changes and every 30 seconds while the
view has an obstruction survey. Closing the view clears the timer. There are no
new network requests or router polls. Missing or invalid coordinates give a night
sky without Sun/Moon markers. Obstruction-history scrubbing changes the survey,
not the celestial clock. The dashboard obstruction card shares the same resolved
location, sky exposure, and Sun/Moon markers, without satellites, trails, or beams.
Its fixed camera and obstruction controls remain unchanged; markers outside the
current camera view are not forced into view. Its timer stops when unmounted or
when no survey/location is available.

Shared calculation lives in `src/lib/celestial.ts`, exposure in
`src/lib/skyLighting.ts`, and procedural markers in
`src/components/satellite/celestialMarkers.ts`. Production never imports the
preview DOM entry. The isolated preview keeps its manual UTC inputs, comparison
checkbox, and slider; none of those controls ship in the production view.

## Accuracy and appearance

Paul Schlyter's low-precision orbital elements and selected lunar perturbations
approximate local bearings, lunar parallax, and illumination:
https://stjarnhimlen.se/comp/ppcomp.html (sections 4–13 and 15).
This is not a precision ephemeris or an eclipse predictor. Do not use it for
navigation, occultations, or exact rise/set times. Omitted terms include
refraction, nutation, aberration, TT−UTC, Earth flattening, observer height, and
solar parallax. No independent high-precision accuracy guarantee is claimed.
Visibility uses geometric center elevation above zero, not disk limbs,
refraction, or measured terrain obstruction. Bearings near zenith are unstable.

Exposure is a lightweight artistic model: smooth day/twilight colors, a small
blue lunar contribution at night, and faded stars. It is not calibrated sky
scattering or radiometry. Terrain and dish lighting remain baked; satellite
lighting keeps its existing fixed direction. Stars remain illustrative rather
than an astronomical star catalog. Clock correctness depends on the browser OS.
Updates hold cached state for 30 seconds; there is no interpolation or per-frame
astronomy. Camera-facing marker triangles still rebuild each frame. No measured
STB performance claim is made.

Moon radius 4 and Sun radius 4.3 are cosmetic scene distances, not physical scale.
Full disks and SUN/MOON labels indicate direction, not lunar phase shape or size.
Markers retain terrain/dish depth occlusion, but do not write depth or use fog;
satellites, trails, beams, and survey dots draw over them. Full view opts into
framing radius 4.7 at maximum wheel zoom-out. Opening framing stays unchanged;
closer zoom, terrain, or UI panels can hide a marker. Zoom out again after resize
for the new aspect-dependent limit. Default scene options and obstruction-card
framing stay unchanged.
