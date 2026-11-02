// Types every t() key against the English catalog, so a key that is misspelled
// or missing fails typecheck instead of rendering its own name at runtime.

import "i18next";
import type en from "./locales/en.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof en };
  }
}
