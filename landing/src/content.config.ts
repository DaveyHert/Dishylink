import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// The privacy policy lives at the repo root so GitHub shows it beside the code.
// The /privacy page renders that same file, so the two can never disagree.
const policies = defineCollection({
  loader: glob({ pattern: "PRIVACY.md", base: ".." }),
});

const blog = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/blog" }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      publishDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      cover: image().optional(),
      coverAlt: z.string().optional(),
      /** Who a cover belongs to when it is not ours, shown under it as "Image Credit: …". */
      coverCredit: z.string().optional(),
      tags: z.array(z.string()).default([]),
      draft: z.boolean().default(false),
    }),
});

export const collections = { policies, blog };
