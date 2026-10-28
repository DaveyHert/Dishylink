// The renderer's binding of core's error wording to its own catalog instance.

import i18n from "../i18n";
import { errorText as wordError } from "@core/i18n/errors";

/** What to show for a caught error, in the user's language. */
export function errorText(error: unknown): string {
  return wordError(error, i18n.t, (key) => i18n.exists(key));
}
