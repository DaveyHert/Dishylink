// The prompt is the only place a merge can be triggered, and a merge cannot be
// undone — so what matters is that it names the right two records, states the
// right outcome for the month they fall in, and reports which button was pressed.
// A prompt that says "combining keeps 590 GB" when the recorder will not add the
// figures would be talking the user into a number that never appears.

import { expect, describe, test, afterEach, vi } from "vitest";
import { render, cleanup } from "vitest-browser-react";
import type { ClientUsageTotal } from "@core/clientUsage";
import type { MergeCandidate } from "@core/clientTotals";
import { DeviceMergePrompt } from "./DeviceMergePrompt";

const NOW = new Date(2026, 6, 30, 12, 0, 0).getTime();
const JULY = new Date(2026, 6, 1).getTime();
const AUGUST = new Date(2026, 7, 1).getTime();

// 542 + 44 + 48 + 3 = 637 GB, as the recorder would compute it. The prompt quotes
// these numbers; it must not recompute them from the rows.
const candidate: MergeCandidate = {
  fromKey: "13011248",
  toKey: "2806438232",
  reason: "name",
  detail: "MacBook Pro M1",
  foldsBytes: true,
  resultRxBytes: 590_000_000_000,
  resultTxBytes: 47_000_000_000,
};

function total(over: Partial<ClientUsageTotal> & { clientId: number }): ClientUsageTotal {
  return {
    macAddress: "5a:c9:44:XX:XX:XX",
    name: "MacBook Pro M1",
    rxBytes: 0,
    txBytes: 0,
    sinceMs: JULY,
    lastSeenMs: NOW,
    ...over,
  } as ClientUsageTotal;
}

/** The real fork: an idle 542 GB record and a live 48 GB one, both in July. */
const sameMonthTotals = [
  total({
    clientId: 13011248,
    rxBytes: 542_000_000_000,
    txBytes: 44_000_000_000,
    lastSeenMs: NOW - 36 * 3_600_000,
  }),
  total({
    clientId: 2806438232,
    macAddress: "ea:17:b5:XX:XX:XX",
    rxBytes: 48_000_000_000,
    txBytes: 3_000_000_000,
  }),
];

const text = () => document.body.textContent ?? "";

/** Rendering here is not synchronous, so every assertion waits for the DOM to
 *  settle. Polls rather than sleeps, so a passing case costs a few ms. */
async function waitForText(substring: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (text().includes(substring)) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for text: ${substring}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** For "nothing is shown" cases: let the same window pass, then assert absence.
 *  Asserting immediately would pass on an un-flushed render and prove nothing. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 120));
}

/** The button carrying this exact label. Throws when absent, so a renamed button
 *  fails the test it belongs to instead of silently never being pressed. */
function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no button labelled: ${label}`);
  return found as HTMLButtonElement;
}

afterEach(cleanup);

describe("DeviceMergePrompt", () => {
  test("asks about the shared name and shows both records", async () => {
    render(
      <DeviceMergePrompt
        candidates={[candidate]}
        totals={sameMonthTotals}
        nowMs={NOW}
        onAnswer={() => {}}
      />,
    );
    await waitForText("Possible duplicate device");
    expect(text()).toContain("MacBook Pro M1");
    // Each side reads as the device row it is: maker + a labelled router id (not a
    // bare number), the usage a person recognises from the list — 586 GB idle vs
    // 51 GB live — and active-vs-last-seen as the direction of the merge. The
    // masked address reads "Private" for both.
    expect(text()).toContain("Private");
    expect(text()).toContain("Router ID: 13011248");
    expect(text()).toContain("Router ID: 2806438232");
    expect(text()).toContain("586 GB");
    expect(text()).toContain("51 GB");
    expect(text()).toContain("2 days ago");
    expect(text()).toContain("Active now");
  });

  test("states the combined total when both records cover one month", async () => {
    render(
      <DeviceMergePrompt
        candidates={[candidate]}
        totals={sameMonthTotals}
        nowMs={NOW}
        onAnswer={() => {}}
      />,
    );
    await waitForText("Combining keeps one device with");
    // The recorder's figure, not one recomputed here: 590 + 47 = 637 GB.
    expect(text()).toContain("637");
    expect(text()).toContain("joins their usage history");
  });

  test("quotes the recorder's total even when it differs from summing the rows", async () => {
    // A candidate whose stated outcome is deliberately unlike rx+tx of the two
    // rows. The prompt must report what the recorder will do, not its own sum.
    const stated: MergeCandidate = {
      ...candidate,
      resultRxBytes: 1_000_000_000,
      resultTxBytes: 0,
    };
    render(
      <DeviceMergePrompt
        candidates={[stated]}
        totals={sameMonthTotals}
        nowMs={NOW}
        onAnswer={() => {}}
      />,
    );
    await waitForText("Combining keeps one device with");
    expect(text()).toContain("with 1 GB this month");
    expect(text()).not.toContain("637");
  });

  test("promises no combined figure across a month boundary", async () => {
    const totals = [
      sameMonthTotals[0],
      total({
        clientId: 2806438232,
        macAddress: "ea:17:b5:XX:XX:XX",
        rxBytes: 7_000,
        sinceMs: AUGUST,
      }),
    ];
    const split: MergeCandidate = {
      ...candidate,
      foldsBytes: false,
      resultRxBytes: 7_000,
      resultTxBytes: 0,
    };
    render(
      <DeviceMergePrompt candidates={[split]} totals={totals} nowMs={NOW} onAnswer={() => {}} />,
    );
    await waitForText("different months");
    expect(text()).not.toContain("Combining keeps one device with");
  });

  test("reports same-device and different-devices distinctly", async () => {
    const onAnswer = vi.fn();
    render(
      <DeviceMergePrompt
        candidates={[candidate]}
        totals={sameMonthTotals}
        nowMs={NOW}
        onAnswer={onAnswer}
      />,
    );
    await waitForText("Same device");
    button("Same device").click();
    expect(onAnswer).toHaveBeenCalledWith(candidate, true);
    button("Different devices").click();
    expect(onAnswer).toHaveBeenCalledWith(candidate, false);
    // Both answers reach the caller; neither button stands in for the other.
    expect(onAnswer).toHaveBeenCalledTimes(2);
  });

  test("asks one at a time, saying how many remain", async () => {
    const second: MergeCandidate = { ...candidate, fromKey: "999" };
    render(
      <DeviceMergePrompt
        candidates={[candidate, second]}
        totals={sameMonthTotals}
        nowMs={NOW}
        onAnswer={() => {}}
      />,
    );
    await waitForText("1 more to review");
    // Only the first pair is put to the user; the second waits its turn.
    expect(text()).not.toContain("2 more to review");
  });

  test("says nothing when there is nothing to ask", async () => {
    render(
      <DeviceMergePrompt
        candidates={[]}
        totals={sameMonthTotals}
        nowMs={NOW}
        onAnswer={() => {}}
      />,
    );
    await settle();
    expect(text()).not.toContain("Possible duplicate device");
  });

  test("stays silent when a candidate names a record the list does not hold", async () => {
    render(
      <DeviceMergePrompt
        candidates={[candidate]}
        totals={[sameMonthTotals[0]]}
        nowMs={NOW}
        onAnswer={() => {}}
      />,
    );
    await settle();
    expect(text()).not.toContain("Possible duplicate device");
  });
});
