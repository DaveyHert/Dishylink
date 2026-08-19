/** One run at a time: callers arriving while a run is in flight join it rather
 *  than starting a second. The worker is a single instance, so holding the run in
 *  memory is enough to serialise every entry point into it. */
export function singleFlight(run: () => Promise<void>): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  return () => (inFlight ??= run().finally(() => (inFlight = null)));
}
