// A run is bound only by its own phase clock, so nothing but the signal stops it
// early. Closing the speed test panel unmounts the panel while six download
// streams — and then a whole upload phase that begins after the unmount — carry
// on saturating the link, invisibly: progress updates to a gone component are
// silent no-ops. These cover the cancellation contract that teardown relies on.

import { afterEach, describe, expect, it, vi } from "vitest";
import { runSpeedTest } from "./speedTest";

/** A body that never ends on its own, as a real download stream doesn't within
 *  the phase window — it stops only when the request is aborted. */
function endlessBody(signal: AbortSignal) {
  const abortError = () => new DOMException("aborted", "AbortError");
  return {
    getReader: () => ({
      read: async () => {
        if (signal.aborted) throw abortError();
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (signal.aborted) throw abortError();
        return { done: false, value: new Uint8Array(64_000) };
      },
    }),
  };
}

function stubDownload() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { signal: AbortSignal }) => ({
      body: endlessBody(init.signal),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runSpeedTest cancellation", () => {
  it("stops reporting and resolves once cancelled mid-download", async () => {
    stubDownload();
    const controller = new AbortController();
    const phases: string[] = [];

    const run = runSpeedTest((progress) => phases.push(progress.phase), controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(phases[0]).toBe("download");
    // Genuinely mid-flight: every stream is open on the link.
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(6);
    const reportedBeforeAbort = phases.length;

    controller.abort();
    // Resolves on the abort rather than running out the ~26s of phases.
    await run;

    expect(phases.length).toBe(reportedBeforeAbort);
    // The upload phase is the one that used to start after the panel was gone.
    expect(phases).not.toContain("upload");
    // Cancelling is not failing: nobody is left to show an error to.
    expect(phases).not.toContain("error");
  });

  it("reports nothing at all when handed an already-aborted signal", async () => {
    stubDownload();
    const phases: string[] = [];

    await runSpeedTest((progress) => phases.push(progress.phase), AbortSignal.abort());

    expect(phases).toEqual([]);
  });
});
