/**
 * Raised when a live collector already owns the data directory.
 *
 * Its own module so a host can catch it without importing the recorder whose
 * loading is what raises it — a module that throws while evaluating never
 * exposes its exports.
 */
export class CollectorBusyError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "CollectorBusyError";
  }
}
