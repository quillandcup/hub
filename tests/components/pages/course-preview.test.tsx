// @vitest-environment jsdom
/** The public course preview: what a signed-out visitor or a link unfurler sees for a course address. Loader mocked; markup and metadata are real. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { expectRedirect, getCurrentUser, renderServerPage, resetServerPageMocks, signInAs, MEMBER_IDENTITY, MEMBER_USER } from "@/tests/helpers/server-page";
import { APP_URL } from "@/lib/config";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
const publicCoursePreview = vi.fn();
vi.mock("@/lib/courses/public-preview", () => ({ publicCoursePreview: (...a: unknown[]) => publicCoursePreview(...a) }));

import CoursePreviewPage, { generateMetadata } from "@/app/course-preview/[slug]/page";

const COURSE = "crs_AAAAAAAAAAA1";
const params = (slug = "the-ready-writer") => ({ params: Promise.resolve({ slug }) });
const preview = (over: Record<string, unknown> = {}) => ({
  preview: {
    courseId: COURSE,
    slug: "the-ready-writer",
    title: "The Ready Writer",
    excerpt: "A year of guided writing, from idea to finished draft.",
    thumbnailSrc: `/api/courses/image/course/${COURSE}`,
    thumbnailSize: { width: 1280, height: 720 },
    ...over,
  },
});

beforeEach(() => {
  resetServerPageMocks();
  publicCoursePreview.mockReset();
  signInAs(null);
});

describe("/course-preview/[slug]", () => {
  it("shows a signed-out visitor the course's title, teaser and cover, with a way to sign in", async () => {
    publicCoursePreview.mockResolvedValue(preview());
    await renderServerPage(CoursePreviewPage, params());

    expect(screen.getByRole("heading", { name: "The Ready Writer" })).toBeInTheDocument();
    expect(screen.getByText(/year of guided writing/)).toBeInTheDocument();
    expect(document.querySelector("img")).toHaveAttribute("src", `/api/courses/image/course/${COURSE}`);
    expect(screen.getByRole("link", { name: "Sign in to open the course" })).toHaveAttribute("href", "/login");
    expect(screen.getByText("This is a course for members.")).toBeInTheDocument();
  });

  it("asks for this course by its address", async () => {
    publicCoursePreview.mockResolvedValue(preview());
    await renderServerPage(CoursePreviewPage, params());
    expect(publicCoursePreview).toHaveBeenCalledWith(expect.anything(), "the-ready-writer");
  });

  it("shows no picture or teaser that the course doesn't have", async () => {
    publicCoursePreview.mockResolvedValue(preview({ excerpt: null, thumbnailSrc: null, thumbnailSize: null }));
    await renderServerPage(CoursePreviewPage, params());
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByRole("heading", { name: "The Ready Writer" })).toBeInTheDocument();
  });

  it("sends a visitor to the login page when the course isn't public (a draft, not open yet, unknown, or the feature not on for everyone)", async () => {
    publicCoursePreview.mockResolvedValue({ blocked: "course_not_live" });
    await expectRedirect(CoursePreviewPage, params(), "/login");
  });

  it("sends someone who is signed in to the course itself", async () => {
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    publicCoursePreview.mockResolvedValue(preview());
    await expectRedirect(CoursePreviewPage, params(), "/courses/the-ready-writer");
    expect(getCurrentUser).toHaveBeenCalled();
  });
});

describe("the course preview's link metadata", () => {
  it("gives a link unfurler the title, teaser, big picture and the course's own address", async () => {
    publicCoursePreview.mockResolvedValue(preview());
    const meta = await generateMetadata(params());

    expect(meta.title).toBe("The Ready Writer");
    expect(meta.description).toMatch(/year of guided writing/);
    expect(meta.openGraph).toMatchObject({ url: `${APP_URL}/courses/the-ready-writer`, images: [{ url: `${APP_URL}/api/courses/image/course/${COURSE}`, width: 1280, height: 720 }] });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", images: [`${APP_URL}/api/courses/image/course/${COURSE}`] });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("keeps an already absolute cover address (Kajabi's CDN until the copy exists), and declares no size it doesn't know", async () => {
    publicCoursePreview.mockResolvedValue(preview({ thumbnailSrc: "https://cdn.example.test/c.jpg", thumbnailSize: null }));
    const images = (await generateMetadata(params())).openGraph?.images;
    expect(images).toEqual([{ url: "https://cdn.example.test/c.jpg", alt: "The Ready Writer" }]);
  });

  it("falls back to a line about the course when there is no teaser, and a small card without a picture", async () => {
    publicCoursePreview.mockResolvedValue(preview({ excerpt: null, thumbnailSrc: null, thumbnailSize: null }));
    const meta = await generateMetadata(params());
    expect(meta.description).toBe("The Ready Writer, a course for Quill & Cup members. Sign in to open it.");
    expect(meta.twitter).toMatchObject({ card: "summary" });
    expect(meta.openGraph).toMatchObject({ images: undefined });
  });

  it("says nothing about a course that isn't public", async () => {
    publicCoursePreview.mockResolvedValue({ blocked: "not_found" });
    expect(await generateMetadata(params())).toEqual({ title: "Login" });
  });
});
