import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { AppSettingsTab } from "./AppSettingsTab";
import { setLocale } from "../../lib/locale";
import { readTimeFormat } from "../../lib/timeFormat";

afterEach(cleanup);

beforeEach(() => {
  localStorage.clear();
  setLocale("en");
});

describe("AppSettingsTab", () => {
  test("renders the language selector and defaults to English", async () => {
    render(<AppSettingsTab clients={[]} />);
    await expect.element(page.getByText("English", { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText("App toolbar", { exact: true })).toBeInTheDocument();
  });

  test("translates settings tab copy when language is set to Spanish", async () => {
    setLocale("es");
    render(<AppSettingsTab clients={[]} />);
    await expect.element(page.getByText("Español", { exact: true })).toBeInTheDocument();
    await expect
      .element(page.getByText("Barra de herramientas", { exact: true }))
      .toBeInTheDocument();
  });

  test("translates settings tab copy when language is set to French", async () => {
    setLocale("fr");
    render(<AppSettingsTab clients={[]} />);
    await expect.element(page.getByText("Français", { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText("Barre d'outils", { exact: true })).toBeInTheDocument();
  });

  test("the time format starts on Automatic and switches the app to a 24-hour clock", async () => {
    render(<AppSettingsTab clients={[]} />);
    await expect
      .element(page.getByText("How times are shown across the app", { exact: true }))
      .toBeInTheDocument();

    await page.getByText("Automatic", { exact: true }).click();
    await page.getByRole("option", { name: "24-hour" }).click();

    expect(readTimeFormat()).toBe("24h");
    await expect.element(page.getByText("24-hour", { exact: true })).toBeInTheDocument();
  });
});
