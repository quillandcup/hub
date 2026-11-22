# Addresses in stored HTML: what production uses, and what the sanitizers now allow

> **Status:** living. **Last reviewed:** 2026-11-21. Review: yearly. Kept up to date with the code; if it is wrong, fix it.

Production counts read on 2026-11-21. Follow-up to the sanitizer review in `docs/trust/THREAT_MODEL.md` (A03, rich text) and `docs/TODO.md`, "Threat model follow-ups" (3).

## The concern

`src/lib/courses/sanitize.ts` and `src/lib/landing/sanitize.ts` allowed relative addresses. Staff-authored HTML could therefore make a member's browser request any path on our own site: an `<img src="/api/...">` is fetched without a click. Authors are staff, so the risk is low, but it was cheap to close if no existing content needed it.

## What production uses (read-only check)

Method: `select`-only queries through `supabase db query --linked` (`verify-against-prod.md`), a regular expression over each HTML column, counts only, no text read. Lessons: `course_lessons.body_html` (1,001 lessons, 32 with a link or an image). Landing pages: the published and draft data of 5 pages and their 10 saved versions (the templates tables are not in production yet, so they were not checked). Landing rich text lives in the `html` props of that data.

| Where | Attribute | Kind of address | Count |
|---|---|---|---|
| Lesson text | image `src` | absolute http(s) | 10 |
| Lesson text | image `src` | relative (any path), protocol-relative, data, other | 0 |
| Lesson text | link `href` | absolute http(s) | 70 |
| Lesson text | link `href` | mailto | 2 |
| Lesson text | link `href` | relative (any path), anchor, protocol-relative, other | 0 |
| Landing rich text (published, draft, versions) | link `href` or image `src` inside the HTML | any | 0 (no link or image tag at all) |

### Structured link props of landing blocks (read 2026-11-22)

The buttons, links and cards of a landing block hold their address in a prop named `href` or `url`, not in HTML. They went through `safeHref`, which still allowed `/api/...` paths. Method: a `select`-only query over every string value in the data of landing pages (published, draft), their saved versions and the site template with its versions (the template tables from the earlier check are gone from production), counts only. 44 relative values in total (32 in versions, 8 in drafts, 4 published), all site pages (4 distinct first segments, none under `/api`).

| Check | Count |
|---|---|
| String values starting with `/api` | 0 |
| Relative values containing `..`, a backslash, `%2e`, `%2f` or `%5c` | 0 |
| Values starting with `//` | 0 |

So no landing link needs `/api`, and `safeHref` now delegates to the same function as the HTML links (`allowedHtmlHref`): one rule everywhere. A test feeds the page paths and anchors the repo's templates use (`/`, `#...`) and the shapes found in production through it unchanged.

## What the sanitizers do now

Branch taken: every relative address was absent from production, so the allow-lists were tightened (`src/lib/sanitize-urls.ts`, used by both sanitizers):

- Lesson image `src`: http(s), or a path under `IMAGE_ROUTE_PREFIXES` (`src/lib/courses/image-urls.ts`: `/api/courses/image/` and `/api/media/`, the two routes that only read an image). Anything else is dropped, including other paths on this site, `//host`, backslash forms, `..` and `%2e`/`%2f`/`%5c` tricks, and control characters.
- Link `href` (lesson and landing text): http(s), mailto, an in-page `#anchor`, or a page path on this site that does not start with `/api`. Anything else is dropped (the link text stays, without a link).
- Nothing in production changes: all its addresses are absolute. `tests/lib/html-sanitizers-xss.test.ts` feeds every shape in the table plus our image routes and page paths through both sanitizers and expects them unchanged, and attacks (an `/api/` image or link, `//evil.example/x.png`, `/\evil`, `javascript:`, encoded dot segments) expecting them stripped.

- Landing structured links (`href` and `url` props) follow the same rule as the HTML link above, through `safeHref`.

Left as is: the sanitizers still allow a path under `/api/media/` and `/api/courses/image/` in an image, since the lesson editor and the image copy step build such addresses; both routes only serve images.
