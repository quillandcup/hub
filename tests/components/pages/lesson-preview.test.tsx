// @vitest-environment jsdom
/** The public lesson preview: what a signed-out visitor or a link unfurler sees for a lesson address. Loader mocked; markup and metadata are real. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { expectRedirect, getCurrentUser, renderServerPage, resetServerPageMocks, signInAs, MEMBER_IDENTITY, MEMBER_USER } from "@/tests/helpers/server-page";
import { APP_URL } from "@/lib/config";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
const publicLessonPreview = vi.fn();
vi.mock("@/lib/courses/public-preview", () => ({ publicLessonPreview: (...a: unknown[]) => publicLessonPreview(...a) }));

import LessonPreviewPage, { generateMetadata } from "@/app/lesson-preview/[slug]/[lessonId]/page";

const LESSON = "les_AAAAAAAAAAA1";
const params = (slug = "the-ready-writer", lessonId = LESSON) => ({ params: Promise.resolve({ slug, lessonId }) });
const preview = (over: Record<string, unknown> = {}) => ({
  preview: {
    lessonId: LESSON,
    title: "Reader Expectations vs. Reader Preferences",
    excerpt: "Today we talk about the difference between expectations and preferences.",
    courseSlug: "the-ready-writer",
    courseTitle: "The Ready Writer",
    thumbnailSrc: `/api/courses/image/lesson/${LESSON}`,
    ...over,
  },
});

beforeEach(() => {
  resetServerPageMocks();
  publicLessonPreview.mockReset();
  signInAs(null);
});

describe("/lesson-preview/[slug]/[lessonId]", () => {
  it("shows a signed-out visitor the lesson's course, title, excerpt and thumbnail, with a way to sign in", async () => {
    publicLessonPreview.mockResolvedValue(preview());
    await renderServerPage(LessonPreviewPage, params());

    expect(screen.getByRole("heading", { name: "Reader Expectations vs. Reader Preferences" })).toBeInTheDocument();
    expect(screen.getByText("The Ready Writer")).toBeInTheDocument();
    expect(screen.getByText(/difference between expectations and preferences/)).toBeInTheDocument();
    expect(document.querySelector("img")).toHaveAttribute("src", `/api/courses/image/lesson/${LESSON}`);
    expect(screen.getByRole("link", { name: "Sign in to watch" })).toHaveAttribute("href", "/login");
  });

  it("asks only for this course's lesson", async () => {
    publicLessonPreview.mockResolvedValue(preview());
    await renderServerPage(LessonPreviewPage, params());
    expect(publicLessonPreview).toHaveBeenCalledWith(expect.anything(), LESSON, { slug: "the-ready-writer" });
  });

  it("shows no picture or excerpt that the lesson doesn't have", async () => {
    publicLessonPreview.mockResolvedValue(preview({ excerpt: null, thumbnailSrc: null }));
    await renderServerPage(LessonPreviewPage, params());
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByRole("heading", { name: /Reader Expectations/ })).toBeInTheDocument();
  });

  it("sends a visitor to the login page when the lesson isn't public (coming soon, a draft, unknown, or the feature not on for everyone)", async () => {
    publicLessonPreview.mockResolvedValue({ blocked: "not_open" });
    await expectRedirect(LessonPreviewPage, params(), "/login");
  });

  it("sends someone who is signed in to the lesson itself", async () => {
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    publicLessonPreview.mockResolvedValue(preview());
    await expectRedirect(LessonPreviewPage, params(), `/courses/the-ready-writer/lessons/${LESSON}`);
    expect(getCurrentUser).toHaveBeenCalled();
  });

  it("is a 404 for an address that isn't a lesson id, without reading anything", async () => {
    await expect(Promise.resolve().then(() => LessonPreviewPage(params("the-ready-writer", "not-an-id")))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    expect(publicLessonPreview).not.toHaveBeenCalled();
  });
});

describe("the lesson preview's link metadata", () => {
  it("gives a link unfurler the title, teaser, big picture and the lesson's own address", async () => {
    publicLessonPreview.mockResolvedValue(preview());
    const meta = await generateMetadata(params());

    expect(meta.title).toBe("Reader Expectations vs. Reader Preferences · The Ready Writer");
    expect(meta.description).toMatch(/difference between expectations and preferences/);
    expect(meta.openGraph).toMatchObject({ type: "article", url: `${APP_URL}/courses/the-ready-writer/lessons/${LESSON}`, images: [{ url: `${APP_URL}/api/courses/image/lesson/${LESSON}` }] });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", images: [`${APP_URL}/api/courses/image/lesson/${LESSON}`] });
  });

  it("keeps an already absolute picture address (Kajabi's CDN until the copy exists), and asks search engines not to index it", async () => {
    publicLessonPreview.mockResolvedValue(preview({ thumbnailSrc: "https://cdn.example.test/t.jpg" }));
    const meta = await generateMetadata(params());
    expect(meta.openGraph).toMatchObject({ images: [{ url: "https://cdn.example.test/t.jpg" }] });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("falls back to a line about the course when there is no excerpt, and a small card without a picture", async () => {
    publicLessonPreview.mockResolvedValue(preview({ excerpt: null, thumbnailSrc: null }));
    const meta = await generateMetadata(params());
    expect(meta.description).toBe("A lesson in The Ready Writer. Sign in to watch.");
    expect(meta.twitter).toMatchObject({ card: "summary" });
    expect(meta.openGraph).toMatchObject({ images: undefined });
  });

  it("says nothing about a lesson that isn't public", async () => {
    publicLessonPreview.mockResolvedValue({ blocked: "not_open" });
    expect(await generateMetadata(params())).toEqual({ title: "Login" });
    expect(await generateMetadata(params("the-ready-writer", "not-an-id"))).toEqual({ title: "Login" });
  });
});
