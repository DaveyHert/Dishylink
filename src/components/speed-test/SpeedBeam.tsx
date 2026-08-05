import { useCallback, useEffect, useMemo, useRef } from "react";
import { useEasedValue } from "../../hooks/useEasedValue";
import { BeamGround, BeamOrbit, BeamWordmark } from "../../assets/icons/BeamScene";
import { SpeedCaption } from "./SpeedCaption";
import type { DishModel } from "../../lib/dishMesh";
import { dishPngArtFor, type DishPngArt } from "../../lib/dishPngArt";

interface SpeedBeamProps {
  value: number | null;
  mode: "download" | "upload" | "idle";
  caption: string;
  /** True through the whole test — download, upload, and the rest between — so
   *  the beam stays lit across the handoff and goes dark only when it ends. */
  testActive?: boolean;
  /** Which kit to draw. Required: every caller resolves it from the dish, and a
   *  default here would quietly draw the wrong hardware instead of failing. */
  dishModel: DishModel;
}

/** The dish box, at the size it was originally placed. */
const DISH_BOX = 46;

const DISH: [number, number] = [130, 168];
/** Where the dish stands: the centre of the ground rings. */
const DISH_GROUND: [number, number] = [DISH[0], DISH[1] + 6];
const RING_RADII = [26, 50, 76, 104, 134];

// The orbit arc as a quadratic bezier. The drawn path covers t in [0,1] — its
// endpoints sit just past the frame edges, so it reads as a full-width arc. The
// satellites travel a WIDER range of t than that (see TRAVEL below): the bezier
// formula extrapolates the same parabola beyond its endpoints, off both sides of
// the screen, which is how a satellite spends time out of view and only rises in
// as the other is leaving. Endpoints raised a touch above the original 52.
const ARC_P0: [number, number] = [-6, 42];
const ARC_P1: [number, number] = [130, -16];
const ARC_P2: [number, number] = [266, 42];
const ARC_PATH = `M${ARC_P0[0]},${ARC_P0[1]} Q${ARC_P1[0]},${ARC_P1[1]} ${ARC_P2[0]},${ARC_P2[1]}`;
function arcPoint(t: number): [number, number] {
  const u = 1 - t;
  return [
    u * u * ARC_P0[0] + 2 * u * t * ARC_P1[0] + t * t * ARC_P2[0],
    u * u * ARC_P0[1] + 2 * u * t * ARC_P1[1] + t * t * ARC_P2[1],
  ];
}

/** The satellites travel t across this range, wider than the drawn [0,1] arc, so
 *  each spends time off both edges of the screen. The two are half the range
 *  apart, which puts one near mid-arc while the other is off-screen — they only
 *  share the frame briefly, at the edges, as one hands off to the other. */
const TRAVEL_MIN = -0.35;
const TRAVEL_MAX = 1.35;
const TRAVEL_SPAN = TRAVEL_MAX - TRAVEL_MIN;
/** One full loop. Slow — a satellite crossing the sky, not a spinner. */
const ORBIT_PERIOD_MS = 13_000;
/** How dim a satellite sits when it is not the one serving the beam. */
const MUTED_OPACITY = 0.4;
/** One trip of the data packet along the beam. Unhurried, to sit in the same
 *  register as the swell and the orbit rather than darting. */
const PACKET_PERIOD_MS = 2_600;
/** How much of the beam the packet's streak trails behind its head — a flowing
 *  smear of light rather than a solid dot. */
const PACKET_TRAIL = 0.16;
/** Beam, packet and satellites share one colour, and which satellite is serving
 *  stays a matter of opacity. One colour in both directions too: the packet's
 *  direction of travel already says which phase is running, so recolouring the
 *  beam only made the view flicker between two looks mid-test. */
const BEAM_COLOR = "var(--beam)";

/** How central a satellite is within the visible arc; negative once it is off
 *  either end, so the beam always prefers the one actually on screen. */
function servability(t: number): number {
  return t >= 0 && t <= 1 ? 0.5 - Math.abs(t - 0.5) : -1;
}

/** Where the beam leaves the dish: the panel face, from the render's baked exit
 *  anchor, mapped into the box the dish is drawn in. Per kit — a Mini's panel
 *  sits nothing like a mast-mounted High Performance kit's, so a shared guess
 *  would launch the beam off the hardware. */
function beamOrigin(art: DishPngArt): [number, number] {
  const [boxX, boxY] = dishBox(art);
  return [boxX + art.beamExitAnchor[0] * DISH_BOX, boxY + art.beamExitAnchor[1] * DISH_BOX];
}

/** Top-left of the box the art is drawn in, placed so its ground anchor lands on
 *  the centre of the rings. */
function dishBox(art: DishPngArt): [number, number] {
  return [
    DISH_GROUND[0] - art.groundAnchor[0] * DISH_BOX,
    DISH_GROUND[1] - art.groundAnchor[1] * DISH_BOX,
  ];
}

export function SpeedBeam({ value, mode, caption, testActive = false, dishModel }: SpeedBeamProps) {
  const art = dishPngArtFor(dishModel);
  const [boxX, boxY] = dishBox(art);
  const origin = useMemo(() => beamOrigin(art), [art]);
  // Snap to 0 when a run starts (testActive false→true) rather than draining the
  // last result down; the drain between a test's own phases still eases.
  const eased = useEasedValue(value ?? 0, 0.14, testActive);
  const pending = value === null && eased < 0.1;

  const haloRefs = useRef<Array<SVGGElement | null>>([null, null]);
  const beamRef = useRef<SVGGElement | null>(null);
  const beamLineRefs = useRef<Array<SVGLineElement | null>>([null, null]);
  const packetRef = useRef<SVGLineElement | null>(null);

  // Once a test has run the beam stays connected — the link is live — and only
  // the motion (swell, packet) stops. It clears only back at a pristine idle or a
  // failure, both of which reset mode to "idle".
  const connected = testActive || mode !== "idle";

  // Latest test state, read by the rAF loop without restarting it — so the orbit
  // clock never resets and the beam connects to a satellite in place. The origin
  // rides along for the same reason: swapping kit moves the beam's foot, and
  // naming it as a dependency of the loop would restart the orbit to do it.
  const stateRef = useRef({ testActive, mode, origin });
  useEffect(() => {
    stateRef.current = { testActive, mode, origin };
  }, [testActive, mode, origin]);

  const paint = useCallback(
    (
      phase: number,
      elapsedMs: number,
      linked: boolean,
      streamMode: SpeedBeamProps["mode"],
      animate: boolean,
      beamFoot: [number, number],
    ) => {
      // Two satellites, half the travel span apart, each mapped from the phase
      // into the wider [TRAVEL_MIN, TRAVEL_MAX] range they cross.
      const ts: [number, number] = [
        TRAVEL_MIN + ((phase * TRAVEL_SPAN) % TRAVEL_SPAN),
        TRAVEL_MIN + ((phase * TRAVEL_SPAN + TRAVEL_SPAN / 2) % TRAVEL_SPAN),
      ];
      const pts = ts.map(arcPoint) as [[number, number], [number, number]];
      for (let i = 0; i < 2; i++) {
        haloRefs.current[i]?.setAttribute("transform", `translate(${pts[i][0]} ${pts[i][1]})`);
      }

      // Serve whichever satellite is most in view; as it leaves one edge the
      // other is arriving at the far one, so the pick swaps and the beam hands off.
      const served = servability(ts[0]) >= servability(ts[1]) ? 0 : 1;
      for (let i = 0; i < 2; i++) {
        const lit = linked && i === served;
        haloRefs.current[i]?.style.setProperty("opacity", lit ? "1" : String(MUTED_OPACITY));
      }

      const target = pts[served];
      for (const line of beamLineRefs.current) {
        line?.setAttribute("x2", String(target[0]));
        line?.setAttribute("y2", String(target[1]));
      }
      // A slow swell while a test runs, matching the app's breathing beam. Once
      // the test ends the beam holds — the link is still up — it just stops
      // breathing. It goes dark only when unlinked (idle or a failed run).
      const swell = animate ? 0.82 + 0.18 * Math.sin(elapsedMs / 520) : 1;
      beamRef.current?.style.setProperty("opacity", linked ? String(swell) : "0");

      // A packet riding the beam in the direction being measured: down to the
      // dish on download, up to the satellite on upload. Drawn as a short trailing
      // streak, not a dot, so it reads as light flowing rather than a pellet.
      const packet = packetRef.current;
      if (packet && linked && animate) {
        const p = (elapsedMs % PACKET_PERIOD_MS) / PACKET_PERIOD_MS;
        const tail = Math.max(0, p - PACKET_TRAIL);
        const down = streamMode !== "upload";
        const from = down ? target : beamFoot;
        const to = down ? beamFoot : target;
        packet.setAttribute("x1", String(from[0] + (to[0] - from[0]) * tail));
        packet.setAttribute("y1", String(from[1] + (to[1] - from[1]) * tail));
        packet.setAttribute("x2", String(from[0] + (to[0] - from[0]) * p));
        packet.setAttribute("y2", String(from[1] + (to[1] - from[1]) * p));
        packet.style.setProperty("opacity", String(Math.sin(p * Math.PI)));
      } else {
        packet?.style.setProperty("opacity", "0");
      }
    },
    [],
  );

  // The orbit loop — started once and left to run, reading test state from the
  // ref so a test beginning or ending never restarts (and so resets) the clock.
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => {
      const elapsed = now - start;
      const { testActive: active, mode: streamMode, origin: beamFoot } = stateRef.current;
      const linked = active || streamMode !== "idle";
      paint((elapsed / ORBIT_PERIOD_MS) % 1, elapsed, linked, streamMode, active, beamFoot);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [paint]);

  return (
    <div className='flex w-full flex-col items-center'>
      <svg
        viewBox='0 0 260 200'
        className='h-auto w-full max-w-[300px]'
        role='img'
        aria-label={`${caption} ${value?.toFixed(1) ?? "—"} Mbps`}
      >
        <defs>
          {/* The soft bloom around a lit satellite — a gradient, not a filter, so
              it costs nothing to move. */}
          <radialGradient id='halo-glow'>
            <stop offset='0%' stopColor={BEAM_COLOR} stopOpacity='0.55' />
            <stop offset='35%' stopColor={BEAM_COLOR} stopOpacity='0.12' />
            <stop offset='100%' stopColor={BEAM_COLOR} stopOpacity='0' />
          </radialGradient>
          {/* The beam's feathered glow, matching the app. userSpaceOnUse over the
              whole scene so the blur never clips against the beam's thin bbox. */}
          <filter
            id='beam-blur'
            filterUnits='userSpaceOnUse'
            x='0'
            y='-40'
            width='260'
            height='260'
          >
            <feGaussianBlur stdDeviation='2.8' />
          </filter>
        </defs>

        <BeamGround center={DISH_GROUND} radii={RING_RADII} />
        <BeamOrbit d={ARC_PATH} />

        {/* The beam: a blurred glow under a crisp bright core, so the bloom is the
            app's feathered light rather than a hard stroke. Hidden until a test
            runs (opacity from testActive); the rAF sets x2/y2 and the swell. */}
        <g ref={beamRef} style={{ opacity: connected ? 1 : 0 }}>
          <g filter='url(#beam-blur)'>
            <line
              x1={origin[0]}
              y1={origin[1]}
              x2={origin[0]}
              y2={origin[1]}
              ref={(el) => {
                beamLineRefs.current[0] = el;
              }}
              stroke={BEAM_COLOR}
              strokeOpacity={0.8}
              strokeWidth={4.2}
              strokeLinecap='round'
            />
          </g>
          <line
            x1={origin[0]}
            y1={origin[1]}
            x2={origin[0]}
            y2={origin[1]}
            ref={(el) => {
              beamLineRefs.current[1] = el;
            }}
            stroke={BEAM_COLOR}
            strokeOpacity={0.98}
            strokeWidth={1.8}
            strokeLinecap='round'
          />
          {/* the flowing data packet — a soft blurred streak along the beam */}
          <g filter='url(#beam-blur)'>
            <line
              ref={packetRef}
              x1={origin[0]}
              y1={origin[1]}
              x2={origin[0]}
              y2={origin[1]}
              stroke={BEAM_COLOR}
              strokeWidth={4.6}
              strokeLinecap='round'
              style={{ opacity: 0 }}
            />
          </g>
        </g>

        {/* The two satellites, positioned every frame. Muted until one serves the
            beam, then it alone brightens. */}
        {[0, 1].map((i) => (
          <g
            key={i}
            ref={(el) => {
              haloRefs.current[i] = el;
            }}
            style={{ opacity: MUTED_OPACITY }}
          >
            <circle r={14} fill='url(#halo-glow)' />
            <circle r={5.5} fill={BEAM_COLOR} />
          </g>
        ))}

        {/* the dish, over the beam's base so the beam emerges from behind it */}
        <image
          href={art.pngSrc}
          x={boxX}
          y={boxY}
          width={DISH_BOX}
          height={DISH_BOX}
          preserveAspectRatio='none'
        />

        {/* wordmark sits in the clear band left of the beam, below the arc */}
        <BeamWordmark x={78} y={112} />
      </svg>

      <div className='mt-0.5 flex items-baseline gap-1.5'>
        {/* One decimal at every magnitude, so this agrees with the headline figure
            above it — dropping it past 100 made a 118.5 Mbps run read as two
            different numbers on the same screen. */}
        <span
          className={`text-[38px] font-bold tracking-[-0.02em] ${pending ? "text-ink-muted" : "text-ink"}`}
        >
          {pending ? "0" : eased.toFixed(1)}
        </span>
        <span className='text-[13px] font-medium text-ink-muted'>Mbps</span>
      </div>
      <SpeedCaption mode={mode} caption={caption} />
    </div>
  );
}
