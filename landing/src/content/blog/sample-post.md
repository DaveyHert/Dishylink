---
title: "Sample post: how a post is written"
description: A draft that shows the frontmatter and formatting a post can use. It is never built into the live site.
publishDate: 2026-11-10
cover: ../../assets/shots/dashboard-dark.png
coverAlt: The Dishylink dashboard in its dark theme.
draft: true
---

Each post is one Markdown file in `landing/src/content/blog/`. The file name becomes the address, so `sample-post.md` is served at `/blog/sample-post/`.

## Frontmatter

- `title` and `description` are required. The description is shown under the title, in the post list, in search results and in the feed.
- `publishDate` is required. `updatedDate` is optional and adds an "Updated" date.
- `cover` is an optional image path relative to this file. `coverAlt` describes it.
- `draft: true` keeps a post out of the build. Remove the line to publish.

## Formatting

Paragraphs, **bold text**, [links](https://dishylink.com/) and `inline code` work as in any Markdown file.

### Lists

1. Numbered steps read well for instructions.
2. Keep each step to one action.

> A quote stands apart from the text around it.

```sh
npm run dev
```
