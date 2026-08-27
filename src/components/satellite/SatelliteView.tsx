// Full-page sky view: the obstruction dome, this dish, and the live constellation.
//
// Deliberately not a DetailsModal — that centres a card over a blurred backdrop,
// and this wants the whole viewport with nothing behind it, so the scene reads as
// a place rather than a dialog. The dashboard is unmounted while it is open.

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Minimize2, Pause, Play } from "lucide-react";
import type {
  DishObstructionMapJson,
  DishObstructionStatsJson,
  DishStatusJson,
} from "@core/dishClient";
import type { SatelliteFeed } from "../../hooks/useSatellites";
import type { ObserverLocation } from "../../lib/satellites";
import { useObstructionSnapshots } from "../../hooks/useObstructionSnapshots";
import { liveSurvey, snapshotSurvey } from "./skySurvey";
import { ObstructionTimeLapse } from "../obstruction/ObstructionTimeLapse";
import { ObstructionKey, ObstructionStats } from "../obstruction/ObstructionKey";
import { Loading } from "../ui/loading";
import { Callout } from "../ui/callout";
import { LocationSetup } from "./LocationSetup";
import { SatelliteCallout, type SelectedSatellite } from "./SatelliteCallout";
import { buildSatellite } from "./satelliteGeometry";
import { createSkyScene, type ScreenPoint, type SkyScene } from "./skyScene";
import { SkyControl } from "./SkyControl";
import { DomeIcon } from "../../assets/icons/DomeIcon";
import { DomeCanopyIcon } from "../../assets/icons/DomeCanopyIcon";
import { ImmersiveIcon } from "../../assets/icons/ImmersiveIcon";
import { useDomeTrim } from "../../hooks/useDomeTrim";
import { domeTrimEnabled, setDomeTrimEnabled } from "../../lib/domeTrim";

/** Panels float over the sky rather than covering it: dark enough to hold text,
 *  sheer enough that satellites keep crossing behind them. No blur — the sky
 *  should read clearly through these. */
const glassPanel = "border border-[#28282896] bg-[#00000094]";

const siteAction =
  "cursor-pointer border-0 bg-transparent p-0 font-sans text-[11.5px] font-semibold " +
  "text-muted-foreground underline underline-offset-2 hover:text-foreground";

interface SatelliteViewProps {
  obstructionMap: DishObstructionMapJson | null;
  obstructionStats?: DishObstructionStatsJson;
  status: DishStatusJson | null;
  /** True while the dish isn't answering. The serving beam is the dish's live
   *  link made visible, so we can't claim one — it goes quiet until the dish is
   *  back. The constellation itself is ephemeris-driven and stays live. */
  stale?: boolean;
  satellites: SatelliteFeed;
  observerLocation: ObserverLocation | null;
  onLocationSaved: (location: ObserverLocation) => void;
  onClearLocation: () => void;
  onClose: () => void;
}

export function SatelliteView({
  obstructionMap,
  obstructionStats,
  status,
  stale = false,
  satellites,
  observerLocation,
  onLocationSaved,
  onClearLocation,
  onClose,
}: SatelliteViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // State, not a ref: everything below is pushed INTO the scene by an effect, and
  // an effect that cannot name the scene as a dependency cannot know to push
  // again when a new one is built. Held in a ref, a scene created in a later
  // commit than its wiring — which is what happens whenever the view opens
  // before the dish's obstruction map lands — silently never receives the
  // sampler, the picker or the trackers, and the sky stays empty until some
  // unrelated dependency happens to change.
  const [scene, setScene] = useState<SkyScene | null>(null);
  const labelRef = useRef<HTMLDivElement | null>(null);
  const calloutRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLSpanElement | null>(null);
  const [selected, setSelected] = useState<SelectedSatellite | null>(null);
  // Seeded from the scene as it is built, so the button reports the camera's
  // state rather than a copy of its default that can drift out of step.
  const [rotating, setRotating] = useState(false);
  const [domeShown, setDomeShown] = useState(true);
  // Immersive view: clears the panels, scrubber and legend, leaving only the sky
  // and its controls. The buttons stay so the view can be left again.
  const [immersive, setImmersive] = useState(false);
  const trimmed = useDomeTrim();
  const [unsupported, setUnsupported] = useState(false);
  // The picker opens to its form when there is no location, and folds away once one
  // exists — which can happen after the first render, when the dish's GPS arrives.
  // Keyed on the has-location boolean, so a GPS refresh mid-edit does not fold it.
  const hasLocation = observerLocation !== null;
  // Whether the picker is open is the user's to say, but only for the location
  // they said it about: the choice carries the has-location it was made under, so
  // gaining or losing a location falls back to the default for the new one
  // instead of keeping a decision that was about the old one.
  const [pickerChoice, setPickerChoice] = useState<{ hasLocation: boolean; open: boolean } | null>(
    null,
  );
  const changingLocation =
    pickerChoice !== null && pickerChoice.hasLocation === hasLocation
      ? pickerChoice.open
      : !hasLocation;
  const setChangingLocation = (open: boolean) => setPickerChoice({ hasLocation, open });
  const snapshots = useObstructionSnapshots();
  const [scrubIndex, setScrubIndex] = useState<number | null>(null); // null = live

  const live = useMemo(() => liveSurvey(obstructionMap, status), [obstructionMap, status]);
  const viewingHistory = scrubIndex !== null && scrubIndex < snapshots.length;
  const survey = useMemo(
    () =>
      viewingHistory
        ? snapshotSurvey(
            snapshots[scrubIndex],
            obstructionMap?.maxThetaDeg ?? 80,
            status,
            obstructionMap?.mapReferenceFrame,
          )
        : live,
    [
      viewingHistory,
      scrubIndex,
      snapshots,
      obstructionMap?.maxThetaDeg,
      obstructionMap?.mapReferenceFrame,
      status,
      live,
    ],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    addEventListener("keydown", onKeyDown);
    return () => removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Build once, when a survey first exists. `survey` is a new object on every
  // status poll, so depending on it directly would tear the scene down and stand
  // a new one up roughly once a second — hence the ref plus a boolean trigger.
  const surveyRef = useRef(survey);
  useEffect(() => {
    surveyRef.current = survey;
  }, [survey]);
  const hasSurvey = survey !== null;

  useEffect(() => {
    const canvas = canvasRef.current;
    const first = surveyRef.current;
    if (!canvas || !first) return;
    const built = createSkyScene(canvas, first, {
      buildSatelliteMesh: () => buildSatellite("distant"),
      trimUnmapped: domeTrimEnabled(),
    });
    if (!built) {
      setUnsupported(true);
      return;
    }
    setScene(built);
    setRotating(built.isRotating());
    setDomeShown(built.isDomeVisible());
    return () => {
      built.dispose();
      setScene(null);
    };
  }, [hasSurvey]);

  useEffect(() => {
    if (survey) scene?.setSurvey(survey);
  }, [scene, survey]);

  useEffect(() => {
    scene?.setTrimUnmapped(trimmed);
  }, [scene, trimmed]);

  // The constellation is the dish's live sky. It goes quiet while scrubbing
  // history (no live map then) and while the dish is offline — a sky full of
  // moving satellites with no live link reads as invented data, not telemetry.
  useEffect(() => {
    scene?.setSampler(viewingHistory || stale ? null : satellites.sampleSky);
  }, [scene, viewingHistory, stale, satellites.sampleSky]);

  // The beam marks the satellite the dish is serving from. It belongs to the live
  // view only (scrubbed history has no live constellation), and with the dish not
  // answering there is no live link to draw — so it goes quiet in both cases.
  const servingCandidate = viewingHistory || stale ? null : satellites.stats.servingCandidate;
  useEffect(() => {
    scene?.setServing(servingCandidate);
  }, [scene, servingCandidate]);

  // Three DOM elements ride along with satellites: the serving one's name tag,
  // and — on whatever was tapped — the selection ring and its callout. The scene
  // reports each subject's screen position every frame and we write it straight
  // onto the node; going through React state here would re-render at frame rate
  // for no benefit.
  //
  // The ring belongs to the SELECTED satellite, so it has to ride the selected
  // tracker. It once lived inside the label node below, which follows the
  // serving satellite — so it marked the serving one no matter what was tapped.
  const servingName = stale ? null : (satellites.stats.servingCandidate?.name ?? null);
  const selectedName = selected?.sky.name ?? null;
  useEffect(() => {
    if (!scene) return;
    // Hiding is the scene's job: dropping a tracker reports null to it, and each
    // report handler below already hides on null. So clearing the list here is
    // all that scrubbing into history needs.
    if (viewingHistory) {
      scene.setTrackers([]);
      return;
    }
    const trackers = [];
    if (servingName) {
      trackers.push({
        name: servingName,
        report: (at: ScreenPoint | null) => {
          const node = labelRef.current;
          if (!node) return;
          if (!at || at.behind) {
            node.style.opacity = "0";
            return;
          }
          node.style.opacity = "1";
          node.style.transform = `translate(${at.x}px, ${at.y}px)`;
        },
      });
    }
    if (selectedName) {
      trackers.push({
        name: selectedName,
        report: (at: ScreenPoint | null) => {
          const card = calloutRef.current;
          const ring = ringRef.current;
          if (!at || at.behind) {
            if (card) card.style.display = "none";
            if (ring) ring.style.display = "none";
            return;
          }
          if (card) {
            card.style.display = "block";
            card.style.left = `${at.x + 14}px`;
            card.style.top = `${at.y - 10}px`;
          }
          // Centred on the satellite itself, unlike the card beside it.
          if (ring) {
            ring.style.display = "block";
            ring.style.transform = `translate(${at.x}px, ${at.y}px)`;
          }
        },
      });
    }
    scene.setTrackers(trackers);
    return () => scene.setTrackers([]);
  }, [scene, servingName, selectedName, viewingHistory]);

  useEffect(() => {
    if (!scene) return;
    scene.setOnPick(
      viewingHistory
        ? null
        : (sky) => {
            setSelected(sky ? { sky, isServing: sky.name === servingName } : null);
          },
    );
    return () => scene.setOnPick(null);
  }, [scene, viewingHistory, servingName]);

  // Keep an open callout's numbers live, and close it once its satellite drops
  // out of view — the same 1s cadence the dashboard's dome uses.
  useEffect(() => {
    if (!selectedName || !scene) return;
    const timer = window.setInterval(() => {
      const sky = scene.getSatellite(selectedName) ?? null;
      setSelected(sky ? { sky, isServing: sky.name === servingName } : null);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [scene, selectedName, servingName]);

  const site = observerLocation
    ? `${observerLocation.latitudeDeg.toFixed(4)}, ${observerLocation.longitudeDeg.toFixed(4)}`
    : null;

  return (
    // Pinned to the dark token set regardless of the app theme: this is a night
    // sky, and the shared components below read --ink / --baseline / --muted-
    // foreground, which would otherwise render dark-on-dark in light mode.
    <div data-theme='dark' className='fixed inset-0 z-50 bg-page text-foreground'>
      <canvas
        ref={canvasRef}
        className='absolute inset-0 h-full w-full touch-none'
        style={{ cursor: "grab" }}
      />

      {/* Wide enough that LocationSetup's two buttons sit on one row. */}
      <div
        className={`pointer-events-none absolute inset-y-0 left-0 flex w-[380px] flex-col gap-4 overflow-y-auto p-6 ${immersive ? "hidden" : ""}`}
      >
        <div className='flex flex-col gap-1.5'>
          <h1 className='m-0 text-[15px] font-semibold'>Live satellite view</h1>
          <p className='m-0 text-xs leading-relaxed text-[#8b97a8]'>
            Satellites are propagated live from SpaceX's published ephemerides.
          </p>
        </div>

        <div
          className={`pointer-events-auto flex flex-col gap-3.5 rounded-xl px-[16px] py-4 ${glassPanel}`}
        >
          <div className='flex items-baseline justify-between gap-2 text-[12px] font-medium text-muted-foreground'>
            <span>{site ? `site ${site}` : "No location set to fetch live satellites"}</span>
            <span className='flex shrink-0 items-baseline gap-2.5'>
              <button
                type='button'
                className={siteAction}
                onClick={() => setChangingLocation(!changingLocation)}
              >
                {site ? "change" : "set"}
              </button>
              {site && (
                <button
                  type='button'
                  className={siteAction}
                  onClick={() => {
                    onClearLocation();
                    setChangingLocation(false);
                  }}
                >
                  clear
                </button>
              )}
            </span>
          </div>
          <AnimatePresence initial={false}>
            {changingLocation && (
              <motion.div
                key='location-setup'
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
                // Cancels the column's gap, which would otherwise appear in full
                // the moment this mounts and undercut the height animation. The
                // real spacing is LocationSetup's own margin, inside the clip.
                className='-mt-3.5 overflow-hidden'
              >
                <LocationSetup
                  onLocationSaved={(location) => {
                    onLocationSaved(location);
                    setChangingLocation(false);
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <ObstructionStats obstructionStats={obstructionStats} satellites={satellites} />

          {/* The first open sits empty for 10–20s while the ephemerides download
              and propagate. Say so rather than showing an unexplained empty sky. */}
          {satellites.feedState === "loading" && (
            <Loading message="Loading SpaceX's published constellation ephemerides…" />
          )}
          {/* Names whichever side actually failed, rather than blaming the user's
              connection: the usual cause is the public data source being slow.
              Either way the feed retries on its own, so neither asks for a reload. */}
          {satellites.feedState === "error" && (
            <Callout tone='error'>
              {satellites.errorReason === "offline"
                ? "Can't reach the satellite data source — check your internet connection. Retrying automatically."
                : "The satellite data source isn't responding right now. Retrying automatically."}
            </Callout>
          )}
        </div>

        {/* Plain advice under the card, not a boxed callout — sits like the
            "Drag to orbit" hint below. Live view only: a scrubbed snapshot is a
            past sky, so its live obstruction reading does not describe it. */}
        {!viewingHistory && hasSurvey && (
          <p className='m-0 text-xs leading-relaxed text-[#8b97a8]'>
            {(obstructionStats?.fractionObstructed ?? 0) < 0.005
              ? "Your Starlink has an unobstructed view of the sky. The map sharpens as the dish collects data."
              : "Obstructed patches cause brief interruptions as satellites pass behind them."}
          </p>
        )}
      </div>

      {/* Name tag pinned to the serving satellite, positioned imperatively above.
          Amber marks the serving one, matching the legend's key. */}
      <div
        ref={labelRef}
        className='pointer-events-none absolute left-0 top-0 opacity-0'
        style={{ willChange: "transform", color: "var(--chart-warm)" }}
      >
        <span
          className='absolute whitespace-nowrap pl-2.5 font-mono text-[11px] tracking-wide'
          style={{ marginTop: -6 }}
        >
          {servingName?.replace(/\s*\[DTC\]\s*/, "")}
        </span>
      </div>

      {/* Selection marker: only while details are open, and in ink rather than
          amber — amber is the legend's word for "serving", and this ring can
          land on any satellite you tap. Starts hidden for the same reason the
          callout does: the scene reveals it once it knows where it goes. */}
      {selected && (
        <span
          aria-hidden
          ref={ringRef}
          data-slot='satellite-selection-ring'
          className='pointer-events-none absolute left-0 top-0 block rounded-full border'
          style={{
            display: "none",
            width: 13,
            height: 13,
            marginLeft: -6.5,
            marginTop: -6.5,
            // Sheer white: a marker over the sky, not a solid ring drawn on it.
            borderColor: "#ffffff8c",
            willChange: "transform",
          }}
        />
      )}

      <SatelliteCallout ref={calloutRef} selected={selected} onClose={() => setSelected(null)} />

      <div className='absolute right-6 top-5 flex items-center gap-2'>
        <SkyControl
          label={immersive ? "Exit immersive view" : "Immersive view"}
          pressed={immersive}
          onClick={() => setImmersive((on) => !on)}
        >
          <ImmersiveIcon size={14} />
        </SkyControl>
        <SkyControl
          label={domeShown ? "Hide dome" : "Show dome"}
          pressed={!domeShown}
          onClick={() => {
            const shown = scene?.toggleDome() ?? true;
            setDomeShown(shown);
            // Nothing to scrub through with the dome gone — fall back to live so
            // no stale "time-lapse" state lingers behind a hidden scrubber.
            if (!shown) setScrubIndex(null);
          }}
        >
          <DomeCanopyIcon off={!domeShown} />
        </SkyControl>
        <SkyControl
          label={trimmed ? "Show unmapped sky" : "Hide unmapped sky"}
          pressed={trimmed}
          onClick={() => setDomeTrimEnabled(!trimmed)}
        >
          <DomeIcon skirted={trimmed} />
        </SkyControl>
        <SkyControl
          label={rotating ? "Pause rotation" : "Resume rotation"}
          onClick={() => setRotating(scene?.toggleRotation() ?? false)}
        >
          {rotating ? <Pause size={13} /> : <Play size={13} />}
        </SkyControl>
        <SkyControl label='Reset view' onClick={() => scene?.resetView()}>
          <Minimize2 size={13} />
        </SkyControl>
        <SkyControl label='Close' onClick={onClose}>
          ✕
        </SkyControl>
      </div>

      {!immersive && domeShown && snapshots.length >= 2 && (
        <div className='absolute bottom-[96px] left-1/2 w-[min(720px,55vw)] min-w-[320px] -translate-x-1/2'>
          {viewingHistory && scrubIndex !== null && (
            <p className='m-0 pb-1 text-center text-[11.5px] font-medium text-muted-foreground'>
              Viewing the obstruction map as of{" "}
              {new Date(snapshots[scrubIndex].takenAtMs).toLocaleString()}.
            </p>
          )}
          <ObstructionTimeLapse
            snapshots={snapshots}
            scrubIndex={scrubIndex}
            stale={stale}
            onScrub={setScrubIndex}
          />
        </div>
      )}

      {/* The key names the dome's colours, so it goes when the dome does. */}
      {!immersive && domeShown && (
        <div className='pointer-events-none absolute bottom-[22px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-card px-[18px] py-1.5 [&>div]:flex-nowrap [&>div]:pt-0'>
          <ObstructionKey withServing />
        </div>
      )}

      <p
        className={`pointer-events-none absolute bottom-[74px] left-1/2 m-0 -translate-x-1/2 text-[11px] text-[#8b97a8] opacity-80 ${immersive ? "hidden" : ""}`}
      >
        {unsupported
          ? "This browser could not open a WebGL context."
          : !hasSurvey
            ? "Waiting for the dish's obstruction map…"
            : viewingHistory
              ? "time-lapse"
              : "Drag to orbit · Scroll to zoom · Esc to close"}
      </p>
    </div>
  );
}
