import { getCollection, type CollectionEntry } from "astro:content";
import { BLOG } from "../constants";

export type Post = CollectionEntry<"blog">;

/** For search results and the feed, so it names the site; the page's own intro does not need to. */
export const BLOG_DESCRIPTION =
  "The Dishylink blog: guides, how-tos and news for Starlink owners, from the apps you can use on every platform to what is new from Starlink.";

/** Dot colours for the topic filter, which lists the known topics in this order. */
const TOPIC_COLOURS: Record<string, string> = {
  Windows: "#4c8dff",
  macOS: "#c084fc",
  Browser: "#2dd4bf",
  Docker: "#38bdf8",
  Satellites: "#f59e42",
  News: "#fb7185",
};

export const topicColour = (topic: string) => TOPIC_COLOURS[topic] ?? "var(--color-ink-3)";

/** Every tag the posts use: known topics first, then the rest by name. */
export const topicsOf = (posts: Post[]) => {
  const inUse = new Set(posts.flatMap((post) => post.data.tags));
  const known = Object.keys(TOPIC_COLOURS).filter((topic) => inUse.has(topic));
  const others = [...inUse].filter((topic) => !(topic in TOPIC_COLOURS)).sort();
  return [...known, ...others];
};

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
