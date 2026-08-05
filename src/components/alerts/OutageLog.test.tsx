// Guards the row key: it must identify an event by identity, not by its index in
// the newest-first list. With an index key, prepending a newer event shifts every
// index and React rebuilds every row (dropping open tooltips and doing needless
// work). This asserts existing rows keep their exact DOM node across a prepend.
import { afterEach, expect, test } from "vitest";
import { act, useEffect, useState } from "react";
import { cleanup, render } from "vitest-browser-react";
import type { OutageEvent } from "@core/telemetry";
import { OutageLog } from "./OutageLog";

afterEach(cleanup);

const tick = () => new Promise((r) => setTimeout(r, 30));

function ev(startMs: number, cause: string): OutageEvent {
  return { startMs, durationMs: 60_000, cause, severity: "warning" };
}

const rows = () => Array.from(document.querySelectorAll<HTMLElement>(".thin-scroll > div"));

type Setter = (events: OutageEvent[]) => void;
function Harness({ initial, bind }: { initial: OutageEvent[]; bind: (set: Setter) => void }) {
  const [events, setEvents] = useState(initial);
  useEffect(() => bind(setEvents), [bind]);
  return <OutageLog outageEvents={events} />;
}

test("an existing row keeps its DOM node when a newer event is prepended", async () => {
  const older = ev(1000, "obstructed");
  const newer = ev(2000, "no_signal");
  let setEvents: Setter = () => {};
  render(<Harness initial={[older, newer]} bind={(set) => (setEvents = set)} />);
  await tick();

  const before = rows();
  expect(before).toHaveLength(2);
  before.forEach((row, i) => (row.dataset.mark = String(i)));

  // A brand-new newest event lands — the storm case that shifted every index.
  await act(async () => setEvents([older, newer, ev(3000, "booting")]));
  await tick();

  const after = rows();
  expect(after).toHaveLength(3);
  const reused = after.filter((row) => row.dataset.mark !== undefined);
  expect(reused, "both prior rows should be the same DOM nodes, not rebuilt").toHaveLength(2);
});
