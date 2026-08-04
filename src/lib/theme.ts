// Only a resolved light/dark value may reach data-theme: index.css keys every
// dark token off [data-theme="dark"], so "system" on the element paints light.

export type ThemeName = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "dishylink-theme";
export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

export function readTheme(): ThemeName {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "system" ? stored : "dark";
}

export function resolveTheme(theme: ThemeName): ResolvedTheme {
  if (theme !== "system") return theme;
  return window.matchMedia(DARK_SCHEME_QUERY).matches ? "dark" : "light";
}

const NEXT_THEME: Record<ThemeName, ThemeName> = {
  light: "dark",
  dark: "system",
  system: "light",
};

export function nextTheme(theme: ThemeName): ThemeName {
  return NEXT_THEME[theme];
}
