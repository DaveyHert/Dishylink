// Lint rules for the app, the historian, and the dev proxy.
//
// Type-aware linting is deliberately off. `tsc -b` already runs over all four
// tsconfig projects in CI and is the authority on types; turning on
// typescript-eslint's type-checked presets would parse the whole program a second
// time for rules that largely restate what strict TypeScript already refuses.
// What is left here is what the compiler cannot see: unused code, React's hook
// rules, and the handful of correctness traps below.

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "server/data", "public", "**/__screenshots__"] },

  // The browser app.
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettier],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

      // Three React-Compiler-era rules are kept visible but not blocking. Each
      // fires on a pattern this app uses deliberately, and each deserves a
      // decision per site rather than a repo-wide silence or a red build:
      //
      //   refs — the scene surfaces hold their survey in a ref written during
      //     render, precisely so the WebGL setup effect does not tear down and
      //     rebuild the scene each time a new survey arrives (about once a
      //     second). The ref is only ever *read* from effects and the rAF loop.
      //   purity — `Date.now()` as the fallback "now" when no sample has arrived
      //     yet, in charts whose x-axis is wall-clock time.
      //   set-state-in-effect — the async load-then-publish shape in the data
      //     hooks, which predates useSyncExternalStore here.
      //
      // Downgraded, not disabled: `npm run lint` still reports every one.
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",

      // The dish and router are the only hardware this talks to and they punish
      // mistakes by rebooting, so an ignored promise is a real failure mode here:
      // a fire-and-forget RPC whose rejection nobody sees looks like a hang.
      "no-console": ["warn", { allow: ["warn", "error"] }],

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

  // The historian and the dev proxy: Node, no React.
  {
    files: ["server/**/*.mts", "dev/**/*.{ts,mts}", "scripts/**/*.mjs"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettier],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
    },
    rules: {
      // The historian's log *is* its console output — it runs under launchd and
      // its stdout is the service log, so console.log is the intended interface.
      "no-console": "off",
      "no-debugger": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
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
