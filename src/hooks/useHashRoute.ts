// Mirrors one full-viewport view into the URL fragment, so the back button
// closes it and a reload — or a shared link — reopens it.
//
// The fragment rather than a path, deliberately. This ships as a desktop app
// (file://) and a browser extension (chrome-extension://); neither has a server
// to answer a path, and Chromium refuses history.pushState to a new path under
// both. A fragment is same-document everywhere and needs nothing behind it, so
// the same code works in the dev server, the packaged app and the extension.

import { useCallback, useEffect, useRef, useState } from "react";

export function useHashRoute(name: string): [boolean, (open: boolean) => void] {
  const target = `#${name}`;
  const [open, setOpen] = useState(() => window.location.hash === target);
  /**
   * Whether this session is what put the fragment there. Closing steps back
   * through our own entry so the history stays honest — but if the app was
   * loaded straight into the view, there is no entry of ours behind it and
   * stepping back would leave the app entirely.
   */
  const pushedRef = useRef(false);

  useEffect(() => {
    const onHashChange = () => {
      const nowOpen = window.location.hash === target;
      setOpen(nowOpen);
      if (!nowOpen) pushedRef.current = false;
    };
    addEventListener("hashchange", onHashChange);
    return () => removeEventListener("hashchange", onHashChange);
  }, [target]);

  const setRouteOpen = useCallback(
    (next: boolean) => {
      if (next) {
        if (window.location.hash !== target) {
          pushedRef.current = true;
          // A new history entry, so the back button is a close button.
          window.location.hash = name;
        }
        setOpen(true);
        return;
      }
      if (window.location.hash !== target) {
        setOpen(false);
        return;
      }
      if (pushedRef.current) {
        pushedRef.current = false;
        history.back(); // hashchange flips the state
      } else {
        window.location.hash = "";
        setOpen(false);
      }
    },
    [name, target],
  );

  return [open, setRouteOpen];
}
