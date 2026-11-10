import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { BLOG } from "../constants";
import { BLOG_DESCRIPTION, listedPosts } from "../data/blog";

export async function GET(context: APIContext) {
  const posts = await listedPosts();
  return rss({
    title: "Dishylink blog",
    description: BLOG_DESCRIPTION,
    site: context.site ?? "https://dishylink.com",
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.publishDate,
      link: `${BLOG}${post.id}/`,
    })),
  });
}
