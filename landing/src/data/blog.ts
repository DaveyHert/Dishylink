import { getCollection, type CollectionEntry } from "astro:content";
import { BLOG } from "../constants";

export type Post = CollectionEntry<"blog">;

export const BLOG_DESCRIPTION =
  "Guides, comparisons and how-tos for Starlink owners: the apps you can use on every platform, and how to read what your dish is doing.";

/** Newest first. Drafts are listed under `astro dev` only and never reach a build. */
export async function listedPosts() {
  const posts = await getCollection("blog", ({ data }) => import.meta.env.DEV || !data.draft);
  return posts.sort((a, b) => b.data.publishDate.valueOf() - a.data.publishDate.valueOf());
}

export const postPath = (post: Post) => `${BLOG}${post.id}/`;

const WORDS_PER_MINUTE = 220;

export const readingMinutes = (post: Post) =>
  Math.max(1, Math.round((post.body ?? "").split(/\s+/).length / WORDS_PER_MINUTE));

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

export const formatPostDate = (date: Date) => dateFormat.format(date);
