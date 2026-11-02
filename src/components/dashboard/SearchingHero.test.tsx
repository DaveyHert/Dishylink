// The address is the one thing on this screen a stuck user has to act on, so it
// is rendered as a code chip rather than lost in the sentence. The sentence is
// a <Trans> with a named tag; a catalog without the tag silently drops the chip.

import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { DISH_LAN_ADDRESS } from "@core/dishClient";
import { SearchingHero } from "./SearchingHero";
import { setLocale, SUPPORTED_LOCALES } from "../../lib/locale";

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  setLocale("en");
});

for (const { code } of SUPPORTED_LOCALES) {
  test(`renders the dish address as a code chip in ${code}`, async () => {
    setLocale(code);
    const screen = await render(<SearchingHero />);
    const chip = screen.container.querySelector("code");
    expect(chip?.textContent).toBe(DISH_LAN_ADDRESS);
  });
}
