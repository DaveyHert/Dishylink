// Keeps a one-frame React error from blanking the whole app. Without a boundary,
// an uncaught render- or commit-phase throw makes React unmount the entire tree
// and leaves a permanent black screen. Here, a transient throw is swallowed and
// the tree is remounted on the next frame — invisible in practice. Only a fault
// that keeps recurring shows the user anything: a plain notice with a reload.

import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";

/** Silent remount attempts before giving up and showing the notice. */
const RETRY_BUDGET = 3;
/** A failure older than this no longer counts toward the budget, so an app that
 *  glitches once an hour never accumulates its way into the notice. */
const CALM_MS = 10_000;

interface Props {
  children: ReactNode;
}

interface State {
  /** Timestamps of recent catches, pruned to the calm window. */
  failures: number[];
  /** Bumped to remount the subtree after a transient failure. */
  instanceKey: number;
  /** True for the commit that follows a throw, until we decide to retry. */
  failed: boolean;
}

export class RecoveringErrorBoundary extends Component<Props, State> {
  state: State = { failures: [], instanceKey: 0, failed: false };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const now = Date.now();
    const failures = [...this.state.failures, now].filter((t) => now - t < CALM_MS);
    console.error("[dashboard] recovered from a render error", error, info.componentStack);
    if (failures.length > RETRY_BUDGET) {
      // Recurring — stop remounting and leave the notice up.
      this.setState({ failures });
      return;
    }
    // Transient — drop the failed state on the next frame and remount the tree.
    requestAnimationFrame(() =>
      this.setState((prev) => ({
        failures,
        failed: false,
        instanceKey: prev.instanceKey + 1,
      })),
    );
  }

  render() {
    if (this.state.failed) {
      const now = Date.now();
      const recurring = this.state.failures.filter((t) => now - t < CALM_MS).length > RETRY_BUDGET;
      // Transient: render nothing for the single frame before the remount — a
      // gap too short to see. Recurring: a notice the user can act on.
      if (!recurring) return null;
      return (
        <div className='flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center'>
          <p className='text-[15px] text-ink-secondary'>
            The dashboard hit a display error and couldn’t recover on its own.
          </p>
          <button
            type='button'
            onClick={() => window.location.reload()}
            className='cursor-pointer rounded-full bg-[color-mix(in_srgb,var(--ink)_10%,var(--surface))] px-4 py-2 text-[14px] text-ink hover:bg-[color-mix(in_srgb,var(--ink)_16%,var(--surface))]'
          >
            Reload
          </button>
        </div>
      );
    }
    // Keyed so a bump remounts the subtree, but a Fragment so nothing is added
    // to the DOM around the app.
    return <Fragment key={this.state.instanceKey}>{this.props.children}</Fragment>;
  }
}
