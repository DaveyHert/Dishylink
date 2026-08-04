import { useCallback, useEffect, useState } from "react";
import {
  DARK_SCHEME_QUERY,
  THEME_STORAGE_KEY,
  nextTheme,
  readTheme,
  resolveTheme,
  type ThemeName,
} from "../lib/theme";

export function useTheme(): { theme: ThemeName; cycleTheme: () => void } {
  const [theme, setTheme] = useState<ThemeName>(readTheme);

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    document.documentElement.dataset.theme = resolveTheme(theme);
    if (theme !== "system") return;
    const darkScheme = window.matchMedia(DARK_SCHEME_QUERY);
    const followSystem = () => {
      document.documentElement.dataset.theme = resolveTheme("system");
    };
    darkScheme.addEventListener("change", followSystem);
    return () => darkScheme.removeEventListener("change", followSystem);
  }, [theme]);

  return { theme, cycleTheme: useCallback(() => setTheme(nextTheme), []) };
}
