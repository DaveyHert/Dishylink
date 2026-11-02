// Errors that reach a person. Core and the host processes raise them with a
// catalog key rather than a sentence, and the surface that shows them words the
// key in the user's language. Messages from older code paths, or from Starlink
// itself, are plain sentences and pass through untouched.

import type { TFunction } from "i18next";
import type { TranslationKey } from "./resources";

export class LocalizedError extends Error {
  constructor(
    readonly key: TranslationKey,
    readonly vars?: Record<string, string | number>,
  ) {
    super(key);
    this.name = "LocalizedError";
  }
}

/** The sentence to show for an error: its key resolved where it has one, the
 *  message itself otherwise. `exists` is the instance's own key check, so a
 *  message that merely looks like a key is never swallowed. */
export function errorText(error: unknown, t: TFunction, exists: (key: string) => boolean): string {
  if (error instanceof LocalizedError) return t(error.key, error.vars);
  const message = error instanceof Error ? error.message : String(error);
  return exists(message) ? t(message as TranslationKey) : message;
}
