// The device subtitle as a row renders it. Separate from networkFormat's plain
// string version because this one marks up part of the line, and separate from
// the row itself because the detail view shows the same subtitle.

import type { ReactNode } from "react";
import type { WifiClientJson } from "@core/dishClient";
import { deviceSubtitle } from "./networkFormat";

/** Subtitle with a leading "This device" for the viewer's own machine, as the
 *  official app shows it ("This device · Apple"). "This device" is brighter and
 *  semibold to stand out from the muted vendor. Drops the "unknown device"
 *  filler so it never reads "This device · unknown device". */
export function deviceRowSubtitle(client: WifiClientJson, isSelf: boolean): ReactNode {
  const base = deviceSubtitle(client);
  if (!isSelf) return base;
  const rest = base === "unknown device" ? "" : ` · ${base}`;
  return (
    <>
      <span className='font-semibold text-foreground/60'>This device</span>
      {rest}
    </>
  );
}
