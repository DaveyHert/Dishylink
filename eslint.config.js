// Lint rules for every tree in the repo: the browser app, the shared core, the
// Electron host, the historian, the extension, the cloud handler, and the dev
// tooling. A tree with no block here is silently unlinted, so a new one needs a
// `files` entry added below — matching the tsconfig it is checked by.
//
// Type-aware linting is deliberately off. `tsc -b` runs the app, host and
// historian projects and `npm run typecheck:extension` the extension, and those
// are the authority on types; turning on typescript-eslint's type-checked presets
// would parse the whole program a second time for rules that largely restate what
// strict TypeScript already refuses. What is left here is what the compiler cannot
// see: unused code, React's hook rules, and the handful of correctness traps below.

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "dist-electron",
      "release",
      ".output",
      ".wxt",
      "node_modules",
      // Astro's generated types, written wherever astro is run from.
      "**/.astro",
      "landing/dist",
      // The historian's recordings, not source.
      "collector/data",
      "public",
      "**/__screenshots__",
    ],
  },

  // Every source file, whatever tree it sits in.
  //
  // Coverage is the default on purpose. A config that names each tree has to be
  // extended by hand whenever one is added, and a tree nobody remembers to add is
  // not reported as uncovered — it is silently unlinted. Matching everything means
  // a new tree is linted the day it appears; the blocks below only refine what
  // applies to it.
  //
  // Node and browser globals together, because the shared trees are imported from
  // both sides: core and the extension's libraries run in a page and in a service
  // worker, the Electron host and the historian run in Node.
  {
    files: ["**/*.{ts,tsx,mts,mjs,js}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettier],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // A leftover debugger statement in a dashboard that runs unattended for
      // days would freeze the render loop on whoever opens devtools.
      "no-debugger": "error",

      // Argument to `_`-prefixed unused vars: destructuring to drop a field is a
      // normal idiom and not worth renaming around.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },

  // The browser app: the only tree with React in it.
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

      // react-hooks/refs, purity and set-state-in-effect stay at the severity the
      // recommended set gives them. The patterns they catch all have a shape that
      // satisfies them: a ref the frame loop reads is written from an effect, a
      // wall-clock "now" comes from useNow so it ticks, and state that a render
      // can derive is derived instead of reset by an effect.

      // A stray console.log ships to users in a dashboard meant to run for days;
      // warn and error are the two that carry real diagnostics worth keeping.
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  // Where console output is the interface rather than a leftover debug print: the
  // historian's stdout is its service log under launchd, and the dev proxy and
  // build scripts report to whoever started them.
  {
    files: ["collector/**/*.{ts,mts}", "dev/**/*.{ts,mts}", "scripts/**/*.mjs"],
    rules: { "no-console": "off" },
  },

  // Tests reach for shapes the app never would, and a partial fixture cast is
  // clearer than building a whole valid status reply to assert one field.
  {
    files: ["**/*.test.{ts,tsx,mts}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
