// The chime that rides alongside an alert notification, the way a phone or a
// laptop makes a sound when a notification drops.
//
// Synthesised rather than a bundled audio file: the whole tone is three numbers,
// and it keeps a binary asset out of the repo. Each severity gets its own
// interval — critical falls (an urgent two-note drop), warning rises gently,
// and a clear is a single soft note — so the alert is recognisable without
// looking at the screen.
//
// Browsers refuse to start audio that no gesture asked for, so the context is
// created and resumed inside the notifications toggle click (`unlockAlertSound`)
// and merely reused afterwards.

import type { AlertSeverity } from "./dishAlerts";

const ENABLED_STORAGE_KEY = "dishboard-alert-sound";

/** Note pairs in Hz. A falling interval reads as urgent, a rising one as benign. */
const TONES: Record<AlertSeverity, number[]> = {
  critical: [880, 587.33],
  warning: [587.33, 880],
  advisory: [659.25],
};

const CLEARED_TONE = [523.25];

let audioContext: AudioContext | null = null;

function audioSupported(): boolean {
  return typeof window !== "undefined" && "AudioContext" in window;
}

export function alertSoundEnabled(): boolean {
  return audioSupported() && localStorage.getItem(ENABLED_STORAGE_KEY) !== "off";
}

export function setAlertSoundEnabled(enabled: boolean): void {
  localStorage.setItem(ENABLED_STORAGE_KEY, enabled ? "on" : "off");
}

/** Open (or resume) the audio context. Must be called from a user gesture. */
export function unlockAlertSound(): void {
  if (!audioSupported()) return;
  audioContext ??= new AudioContext();
  if (audioContext.state === "suspended") void audioContext.resume();
}

/**
 * Unlock on the first interaction of the session, whatever it is.
 *
 * Hanging this off the notifications toggle alone would mean silence for the
 * common case: someone who enabled notifications in an earlier session has no
 * reason to touch the toggle again, so the context would never open and every
 * alert would arrive mute. A one-shot listener costs nothing and covers it.
 */
export function armAlertSoundOnFirstGesture(): () => void {
  if (!audioSupported()) return () => {};
  const controller = new AbortController();
  const unlock = () => {
    unlockAlertSound();
    controller.abort();
  };
  for (const eventName of ["pointerdown", "keydown"] as const) {
    window.addEventListener(eventName, unlock, { once: true, signal: controller.signal });
  }
  return () => controller.abort();
}

/** One note: a sine with a short percussive envelope, so it reads as a chime. */
function playNote(context: AudioContext, frequency: number, startAt: number, duration: number) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  // Ramps rather than steps: an instant gain change clicks.
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(0.18, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration);
}

// The chime's own flap protection. Deliberately not the notification system's
// throttle: sound must work with notifications disabled or browser-blocked.
const THROTTLE_MS = 60_000;
const lastPlayedAtByKey = new Map<string, number>();

/** Chime for an alert opening (severity-toned) or clearing. A `throttleKey`
 *  rate-limits repeats of the same alert; omit it for one-off UI feedback. */
export function playAlertSound(severity: AlertSeverity, cleared = false, throttleKey?: string): void {
  if (!alertSoundEnabled() || audioContext === null) return;
  if (throttleKey !== undefined) {
    const lastPlayedAtMs = lastPlayedAtByKey.get(throttleKey) ?? 0;
    if (Date.now() - lastPlayedAtMs < THROTTLE_MS) return;
    lastPlayedAtByKey.set(throttleKey, Date.now());
  }
  if (audioContext.state === "suspended") void audioContext.resume();

  const notes = cleared ? CLEARED_TONE : TONES[severity];
  const noteDuration = 0.26;
  const startAt = audioContext.currentTime + 0.01;
  notes.forEach((frequency, index) => {
    playNote(audioContext!, frequency, startAt + index * 0.13, noteDuration);
  });
}
