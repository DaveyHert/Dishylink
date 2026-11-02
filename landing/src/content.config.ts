import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";

// The privacy policy lives at the repo root so GitHub shows it beside the code.
// The /privacy page renders that same file, so the two can never disagree.
const policies = defineCollection({
  loader: glob({ pattern: "PRIVACY.md", base: ".." }),
});

export const collections = { policies };
