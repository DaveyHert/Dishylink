// The calendar is the one control here backed by a third-party grid, so what is
// asserted is the contract across that boundary: dates go in and come back as
// YYYY-MM-DD, a range takes two clicks with the first leaving it open, and days
// before today cannot be picked at all.

import { useState } from "react";
import { expect, describe, test, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup } from "vitest-browser-react";
import { Calendar } from "./calendar";

/**
 * The grid refuses everything before today, so every day these tests click is
 * either side of a moving line. Read off the real clock they pass on the days
 * that happen to fall the right way and fail on the rest — a suite that breaks by
 * the calendar rather than by a change. Pinned mid-month instead: the 1st is
 * always behind, the 20th and 24th always ahead.
 */
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0));
});

const text = () => document.body.textContent ?? "";

/** Holds the span the way the schedule form holds it. */
function Harness({ range, opening }: { range?: boolean; opening?: [string, string?] }) {
  const [span, setSpan] = useState<[string?, string?]>(opening ?? []);
  return (
    <>
      <output data-testid='span'>{`${span[0] ?? "-"}/${span[1] ?? "-"}`}</output>
      <Calendar
        range={range}
        from={span[0]}
        to={span[1]}
        onChange={(from, to) => setSpan([from, to])}
      />
    </>
  );
}

const span = () => document.querySelector('[data-testid="span"]')?.textContent ?? "";
/** By the cell's own date, not the figure printed in it: two months are on
 *  screen in range mode and both carry a "20". */
const dayCell = (dateKey: string) => document.querySelector<HTMLElement>(`[data-day="${dateKey}"]`);
const dayButton = (dateKey: string) => dayCell(dateKey)?.querySelector("button");

/** The pinned month. Every day named below sits in it, so no assertion straddles
 *  a month boundary. */
const MID_MONTH = { key: "2026-06" };

describe("Calendar", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  test("given: a single date, should: hand back both ends on the day picked", async () => {
    render(<Harness opening={[`${MID_MONTH.key}-15`]} />);
    await expect.poll(text).toContain("15");

    dayButton(`${MID_MONTH.key}-20`)?.click();

    await expect.poll(span).toBe(`${MID_MONTH.key}-20/${MID_MONTH.key}-20`);
  });

  test("given: a range, should: leave the span open until the second click", async () => {
    render(<Harness range opening={[`${MID_MONTH.key}-15`, `${MID_MONTH.key}-18`]} />);
    await expect.poll(text).toContain("15");

    // A finished span reopens on the day clicked rather than extending.
    dayButton(`${MID_MONTH.key}-20`)?.click();
    await expect.poll(span).toBe(`${MID_MONTH.key}-20/-`);

    dayButton(`${MID_MONTH.key}-24`)?.click();
    await expect.poll(span).toBe(`${MID_MONTH.key}-20/${MID_MONTH.key}-24`);
  });

  // The shape of a range: one continuous band with a pill on each end. Every day
  // between them is `selected` as far as the library is concerned, so without
  // this the whole run comes out as a row of pills.
  test("given: a range, should: pill only its ends and band the days between", async () => {
    render(<Harness range opening={[`${MID_MONTH.key}-20`, `${MID_MONTH.key}-24`]} />);
    await expect.poll(() => dayButton(`${MID_MONTH.key}-22`)).toBeTruthy();

    const transparent = "rgba(0, 0, 0, 0)";
    expect(getComputedStyle(dayButton(`${MID_MONTH.key}-22`)!).backgroundColor).toBe(transparent);
    expect(getComputedStyle(dayButton(`${MID_MONTH.key}-20`)!).backgroundColor).not.toBe(
      transparent,
    );
    expect(getComputedStyle(dayButton(`${MID_MONTH.key}-24`)!).backgroundColor).not.toBe(
      transparent,
    );
    // The band is on the cell, so it meets the cell either side of it.
    expect(getComputedStyle(dayCell(`${MID_MONTH.key}-22`)!).backgroundColor).not.toBe(transparent);
  });

  test("given: a range, should: show two months rather than one", async () => {
    render(<Harness range />);
    // Both the nav's month and the one after it carry a caption.
    await expect.poll(() => document.querySelectorAll("table").length).toBe(2);
  });

  test("given: a day before today, should: refuse it rather than pick it", async () => {
    render(<Harness opening={[`${MID_MONTH.key}-15`]} />);
    await expect.poll(text).toContain("1");

    const first = dayButton(`${MID_MONTH.key}-01`);
    expect(first?.hasAttribute("disabled")).toBe(true);
    first?.click();
    await expect.poll(span).toBe(`${MID_MONTH.key}-15/-`);
  });
});
