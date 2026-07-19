// Dev-only workaround for a React 19.2 "Performance Tracks" crash.
//
// In dev, react-dom serializes a component's changed props into
// performance.measure() on every render, walking arrays with no size cap. This
// app hands <TelemetryChart> the dish's telemetry buffer (up to 6h * 1Hz =
// 21,600 samples), so that serialization exhausts the tab's memory and throws
// mid-commit — which wedges React's root: clicks stop working everywhere (CSS
// :hover still works) and the tab eventually crashes ("Aw, Snap!").
//
// react-dom gates that whole path on one flag computed once at import time,
// which requires `typeof console.timeStamp === "function"`. Making it a
// non-function here — before react-dom is imported (this is the first import in
// main.tsx) — turns the flag off, so React never builds the serialization.
//
// It must be `undefined`, not a no-op function: a function still passes the
// `typeof === "function"` check and would do nothing. Nothing in this app uses
// console.timeStamp. Cost: this disables all of React's dev performance tracks,
// not just the offending one. Production builds strip the instrumentation, so
// they're unaffected. Remove this once the upstream serialization gains a cap.

if (import.meta.env.DEV && typeof console !== "undefined") {
  (console as { timeStamp?: unknown }).timeStamp = undefined;
}

export {};
