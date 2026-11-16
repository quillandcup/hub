import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { APP_URL } from "@/lib/config";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { courseRow, lessonRow } from "@/tests/helpers/course-fixtures";
import { publicCoursePreview, publicLessonPreview } from "@/lib/courses/public-preview";
import { courseShareCard, lessonShareCard, PUBLIC_ROUTES, publicTarget, shareCardMetadata, siteShareCard } from "@/lib/link-unfurl/share-cards";
import { unfurlHubLinks, type LinkSharedEvent } from "@/lib/chat/slack-link-unfurl";
import { DEFAULT_TITLE, documentTitle, PUBLIC_PAGE_TITLES, SITE_DESCRIPTION } from "@/lib/page-title";

/**
 * Links to the Hub's PUBLIC pages keep the card their Open Graph tags give once the Slack app answers for the host (it replaces the crawler):
 * one description (`ShareCard`) feeds both the page's metadata and the app's answer, and this suite checks each public kind against the same
 * fixtures, and that every public route has been decided on.
 */
const COURSE = "crs_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";

const repos = (over: { course?: Partial<Parameters<typeof courseRow>[0]>; lesson?: Partial<Parameters<typeof lessonRow>[0]> } = {}) =>
  createInMemoryRepos(
    new InMemoryDataset({
      courses: [courseRow({ id: COURSE, slug: "the-ready-writer", title: "The Ready Writer", description: "<p>Write a book &amp; finish it.</p>", ...over.course })],
      courseLessons: [lessonRow({ id: LESSON, course_id: COURSE, title: "Show up for the page", ...over.lesson })],
    }),
  );

const sent = () => {
  const unfurl = vi.fn(async (_args: Record<string, unknown>) => ({ ok: true }));
  return { slack: { chat: { unfurl } } as never, unfurl };
};
const event = (urls: string[]): LinkSharedEvent => ({ channel: "C1", messageTs: "1.1", unfurlId: "U1-abc", source: "conversations_history", urls });
const answered = (unfurl: ReturnType<typeof sent>["unfurl"]) => (unfurl.mock.calls[0][0] as { unfurls: Record<string, Record<string, string>> }).unfurls;

describe("the Slack answer for a public course", () => {
  it("is the same title, description and picture as the page's Open Graph tags", async () => {
    const r = repos({ course: { thumbnail_url: "https://cdn.example.test/cover.jpg" } });
    const url = `${APP_URL}/courses/the-ready-writer`;
    const { slack, unfurl } = sent();
    await unfurlHubLinks(event([url]), { repos: r, slack, descriptive: false });
    const preview = (await publicCoursePreview(r, "the-ready-writer")) as { preview: Parameters<typeof courseShareCard>[0] };
    const meta = shareCardMetadata(courseShareCard(preview.preview));
    expect(answered(unfurl)[url]).toEqual({ title: meta.openGraph.title, title_link: url, text: meta.openGraph.description, image_url: meta.openGraph.images?.[0].url });
    expect(answered(unfurl)[url]).toMatchObject({ title: "The Ready Writer", text: "Write a book & finish it.", image_url: "https://cdn.example.test/cover.jpg" });
  });

  it("is answered whatever the Hub-card flag says (it is public, and was a card before the domain was registered)", async () => {
    const { slack, unfurl } = sent();
    await unfurlHubLinks(event([`${APP_URL}/courses/the-ready-writer`]), { repos: repos(), slack, descriptive: false });
    expect(unfurl).toHaveBeenCalledTimes(1);
  });

  it("makes our own picture's relative address absolute, and leaves out a picture that is not https", async () => {
    const own = repos({ course: { thumbnail_asset_id: "media_AAAAAAAAAAA1" } });
    const { slack, unfurl } = sent();
    const url = `${APP_URL}/courses/the-ready-writer`;
    await unfurlHubLinks(event([url]), { repos: own, slack, descriptive: false });
    expect(answered(unfurl)[url].image_url).toBe(`${APP_URL}/api/courses/image/course/${COURSE}`);
    const plain = sent();
    await unfurlHubLinks(event([url]), { repos: repos(), slack: plain.slack, descriptive: false });
    expect(answered(plain.unfurl)[url]).not.toHaveProperty("image_url");
  });

  it("is no answer for a draft or unknown course (the page sends the visitor to sign in, so the link stays plain)", async () => {
    const { slack, unfurl } = sent();
    expect(await unfurlHubLinks(event([`${APP_URL}/courses/the-ready-writer`]), { repos: repos({ course: { is_draft: true } }), slack, descriptive: true })).toEqual({ status: "nothing" });
    expect(await unfurlHubLinks(event([`${APP_URL}/courses/unknown`]), { repos: repos(), slack, descriptive: true })).toEqual({ status: "nothing" });
    expect(unfurl).not.toHaveBeenCalled();
  });
});

describe("the Slack answer for a public lesson", () => {
  it("is the same title, teaser and thumbnail as the page's Open Graph tags", async () => {
    const r = repos({ lesson: { thumbnail_url: "https://cdn.example.test/t.jpg" } });
    const url = `${APP_URL}/courses/the-ready-writer/lessons/${LESSON}`;
    const { slack, unfurl } = sent();
    await unfurlHubLinks(event([url]), { repos: r, slack, descriptive: false });
    const preview = (await publicLessonPreview(r, LESSON, { slug: "the-ready-writer" })) as { preview: Parameters<typeof lessonShareCard>[0] };
    const meta = shareCardMetadata(lessonShareCard(preview.preview));
    expect(answered(unfurl)[url]).toEqual({ title: meta.openGraph.title, title_link: url, text: meta.openGraph.description, image_url: "https://cdn.example.test/t.jpg" });
    expect(answered(unfurl)[url].title).toBe("Show up for the page · The Ready Writer");
    expect(meta.openGraph.type).toBe("article");
  });

  it("is no answer for a lesson that is not public (coming soon, a draft course, another course's address, a malformed id)", async () => {
    const { slack, unfurl } = sent();
    for (const [r, path] of [
      [repos({ lesson: { state: "coming_soon" } }), `/courses/the-ready-writer/lessons/${LESSON}`],
      [repos({ course: { is_draft: true } }), `/courses/the-ready-writer/lessons/${LESSON}`],
      [repos(), `/courses/other/lessons/${LESSON}`],
      [repos(), "/courses/the-ready-writer/lessons/not-an-id"],
    ] as const) {
      expect(await unfurlHubLinks(event([`${APP_URL}${path}`]), { repos: r, slack, descriptive: true }), path).toEqual({ status: "nothing" });
    }
    expect(unfurl).not.toHaveBeenCalled();
  });
});

describe("the Slack answer for the site's own public pages", () => {
  it("is the site card under each page's title, the one the root layout's tags give", async () => {
    for (const [pathname, title] of [["/login", PUBLIC_PAGE_TITLES.login], ["/privacy", PUBLIC_PAGE_TITLES.privacy], ["/", PUBLIC_PAGE_TITLES.login]] as const) {
      const { slack, unfurl } = sent();
      const url = `${APP_URL}${pathname}`;
      await unfurlHubLinks(event([url]), { repos: repos(), slack, descriptive: false });
      expect(answered(unfurl)[url], pathname).toEqual({ title: documentTitle(title), title_link: url, text: SITE_DESCRIPTION, image_url: `${APP_URL}/opengraph-image.jpg` });
    }
    expect(siteShareCard("/privacy", "Privacy").title).toBe("Privacy | Hedgie Hub");
    expect(DEFAULT_TITLE).toBe("Hedgie Hub");
  });
});

describe("publicTarget", () => {
  it("knows the public pages by path, ignoring a trailing slash, and nothing else", () => {
    expect(publicTarget(`/courses/the-ready-writer/lessons/${LESSON}/`)).toEqual({ kind: "lesson", slug: "the-ready-writer", lessonId: LESSON });
    expect(publicTarget("/courses/the-ready-writer")).toEqual({ kind: "course", slug: "the-ready-writer" });
    expect(publicTarget("/privacy")).toMatchObject({ kind: "site" });
    for (const other of ["/dashboard", "/unsubscribe", "/courses", "/courses/x/modules/y", "/admin", "/lesson-preview/x/y"]) expect(publicTarget(other), other).toBeNull();
  });
});

/** Every page.tsx outside the member and admin areas. A new one must be listed in PUBLIC_ROUTES, with whether the Slack app answers for it. */
function publicPages(dir = "app"): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "(member)" || entry.name === "(admin)" || entry.name === "api") continue;
      out.push(...publicPages(full));
    } else if (entry.name === "page.tsx") out.push(full);
  }
  return out.sort();
}

describe("the public routes guard", () => {
  it("lists every page outside the member and admin areas, so a new public page gets a decision (a card, or none and why)", () => {
    expect(publicPages()).toEqual(Object.keys(PUBLIC_ROUTES).sort());
  });

  it("gives every entry a reason, and a card entry has a path the Slack app recognizes", () => {
    for (const [file, decision] of Object.entries(PUBLIC_ROUTES)) {
      expect(decision.reason.length, file).toBeGreaterThan(10);
      expect(["card", "none"]).toContain(decision.slack);
    }
    for (const sample of ["/", "/login", "/privacy", "/courses/some-course", `/courses/some-course/lessons/${LESSON}`]) expect(publicTarget(sample), sample).not.toBeNull();
  });

  it("finds Open Graph metadata only where it was decided: a public page that sets its own openGraph is a card", () => {
    for (const file of publicPages()) {
      const sets = /openGraph|shareCardMetadata/.test(fs.readFileSync(file, "utf8"));
      if (sets) expect(PUBLIC_ROUTES[file]?.slack, `${file} sets Open Graph tags, so the Slack app must answer with the same card`).toBe("card");
    }
  });
});
