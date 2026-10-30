// @vitest-environment jsdom
/** One lesson's builder page: the lesson as last imported, every change control disabled. Loader mocked; markup is real. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderServerPage, resetServerPageMocks, useFakeSupabase } from "@/tests/helpers/server-page";
import { SUPPORT_EMAIL } from "@/lib/config";
import type { AdminLessonDetail } from "@/lib/courses/admin";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
const requireAdminPage = vi.fn(async () => undefined);
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: () => requireAdminPage() }));
const loadAdminLesson = vi.fn();
vi.mock("@/lib/courses/admin", () => ({ loadAdminLesson: (...a: unknown[]) => loadAdminLesson(...a) }));
vi.mock("@/app/(admin)/admin/courses/[id]/LessonStaffTools", () => ({
  default: (props: { lessonId: string; preview: boolean }) => <div data-testid="staff-tools" data-lesson={props.lessonId} data-preview={String(props.preview)} />,
}));

const signPlaybackTokens = vi.fn();
vi.mock("@/lib/mux", () => ({ createMuxClient: () => ({}), signPlaybackTokens: (...a: unknown[]) => signPlaybackTokens(...a) }));
vi.mock("@/components/courses/LessonPlayer", () => ({
  default: (props: { title: string; playbackId: string; posterUrl?: string | null; trackProgress?: boolean }) => (
    <div data-testid="player" data-playback={props.playbackId} data-poster={props.posterUrl ?? ""} data-tracking={String(!!props.trackProgress)} />
  ),
}));

import AdminLessonPage, { generateMetadata } from "@/app/(admin)/admin/courses/[id]/lessons/[lessonId]/page";

const detail = (over: Partial<AdminLessonDetail> = {}, lesson: Partial<AdminLessonDetail["lesson"]> = {}): AdminLessonDetail => ({
  course: { kajabiId: "k1", title: "The Ready Writer" },
  lesson: {
    kajabiId: "l1",
    title: "Reader Expectations vs. Reader Preferences",
    publishingOption: "published",
    state: "coming_soon",
    reason: "Inside “Module 2” (Locked)",
    bodyHtml: "<p>Hey Hedgies</p>",
    thumbnailSrc: "https://example.com/t.jpg",
    videoDurationSeconds: 410,
    hasVideo: true,
    contentFetchedAt: "2026-11-03T15:30:00Z",
    fetchedAt: "2026-11-03T15:30:00Z",
    ...lesson,
  },
  trail: [
    { kajabiId: "m2", title: "Module 2", publishingOption: "locked" },
    { kajabiId: "w1", title: "Week 1", publishingOption: "published" },
  ],
  modules: [
    { kajabiId: "m2", path: "Module 2" },
    { kajabiId: "w1", path: "Module 2 / Week 1" },
  ],
  files: [{ filename: "Tracker_Sheet.pdf", sizeBytes: 2048 }],
  hub: { slug: "the-ready-writer", lessonId: "les_AAAAAAAAAAA1" },
  video: { status: "ready", playbackId: "pb1" },
  ...over,
});
const params = { params: Promise.resolve({ id: "k1", lessonId: "l1" }) };

beforeEach(() => {
  resetServerPageMocks();
  useFakeSupabase();
  requireAdminPage.mockClear();
  loadAdminLesson.mockReset();
  signPlaybackTokens.mockReset();
  signPlaybackTokens.mockResolvedValue({ playback: "p", poster: "t", storyboard: "s" });
});

describe("/admin/courses/[id]/lessons/[lessonId]", () => {
  it("checks the caller is an admin first, and is a 404 for a lesson Kajabi doesn't have", async () => {
    loadAdminLesson.mockResolvedValue(null);
    await expect(Promise.resolve().then(() => AdminLessonPage(params))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    expect(requireAdminPage).toHaveBeenCalled();
  });

  it("shows the lesson as imported: title, module, text, download, thumbnail and status", async () => {
    loadAdminLesson.mockResolvedValue(detail());
    await renderServerPage(AdminLessonPage, params);

    const form = screen.getByRole("form", { name: "Lesson builder" });
    expect(within(form).getByDisplayValue("Reader Expectations vs. Reader Preferences")).toBeDisabled();
    expect(within(form).getByRole("combobox")).toHaveValue("w1");
    expect(within(form).getByText("Hey Hedgies")).toBeInTheDocument();
    expect(within(form).getByText("Tracker_Sheet.pdf")).toBeInTheDocument();
    expect(within(form).getByText("2 KB")).toBeInTheDocument();
    expect(within(form).getByRole("radio", { name: "Published" })).toBeChecked();
    expect(within(form).getByText(/Published in Kajabi. Members see it as coming soon. Inside “Module 2” \(Locked\)/)).toBeInTheDocument();
  });

  it("plays the lesson's video in the builder with the members' player, poster from the lesson thumbnail and no watch tracking", async () => {
    loadAdminLesson.mockResolvedValue(detail());
    await renderServerPage(AdminLessonPage, params);

    expect(signPlaybackTokens).toHaveBeenCalledWith(expect.anything(), "pb1");
    expect(screen.getByTestId("player")).toHaveAttribute("data-playback", "pb1");
    expect(screen.getByTestId("player")).toHaveAttribute("data-poster", "https://example.com/t.jpg");
    expect(screen.getByTestId("player")).toHaveAttribute("data-tracking", "false");
  });

  it("says why there is no player: still preparing, failed, can't be signed, in Kajabi only, or no video", async () => {
    const cases: [Partial<AdminLessonDetail>, RegExp][] = [
      [{ video: { status: "preparing", playbackId: null } }, /still being prepared/],
      [{ video: { status: "errored", playbackId: null } }, /couldn't be prepared/],
      [{ video: null }, /has a video in Kajabi \(6:50\), not in the Hub yet/],
      [{ video: null, hub: null }, /Publish the course to bring it into the Hub/],
    ];
    for (const [over, text] of cases) {
      loadAdminLesson.mockResolvedValue(detail(over));
      const { unmount } = await renderServerPage(AdminLessonPage, params);
      expect(screen.queryByTestId("player")).not.toBeInTheDocument();
      expect(screen.getByText(text)).toBeInTheDocument();
      unmount();
    }
    loadAdminLesson.mockResolvedValue(detail({ video: null }, { hasVideo: false, videoDurationSeconds: null }));
    await renderServerPage(AdminLessonPage, params);
    expect(screen.getByText("No video on this lesson.")).toBeInTheDocument();
  });

  it("says so when Mux can't sign the playback tokens", async () => {
    signPlaybackTokens.mockRejectedValue(new Error("no keys"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    loadAdminLesson.mockResolvedValue(detail());
    await renderServerPage(AdminLessonPage, params);
    expect(screen.queryByTestId("player")).not.toBeInTheDocument();
    expect(screen.getByText(/can't be played right now/)).toBeInTheDocument();
  });

  it("has no use-current-frame button: the thumbnail changes with Image actions, not from a paused frame", async () => {
    loadAdminLesson.mockResolvedValue(detail());
    await renderServerPage(AdminLessonPage, params);
    expect(screen.queryByText(/Use current frame/)).not.toBeInTheDocument();
  });

  it("disables every control that would change the lesson, and points to support in the banner", async () => {
    loadAdminLesson.mockResolvedValue(detail());
    await renderServerPage(AdminLessonPage, params);

    expect(screen.getByRole("link", { name: SUPPORT_EMAIL })).toHaveAttribute("href", `mailto:${SUPPORT_EMAIL}`);
    const form = screen.getByRole("form", { name: "Lesson builder" });
    for (const control of form.querySelectorAll("input, select, textarea, button")) expect(control, control.outerHTML).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete lesson" })).toBeDisabled();
  });

  it("previews in the Hub and offers the staff tools, as a preview when members can't open the lesson", async () => {
    loadAdminLesson.mockResolvedValue(detail());
    await renderServerPage(AdminLessonPage, params);
    expect(screen.getByRole("link", { name: "Preview" })).toHaveAttribute("href", "/courses/the-ready-writer/lessons/les_AAAAAAAAAAA1");
    expect(screen.getByTestId("staff-tools")).toHaveAttribute("data-lesson", "les_AAAAAAAAAAA1");
    expect(screen.getByTestId("staff-tools")).toHaveAttribute("data-preview", "true");
  });

  it("has neither preview nor staff tools for a lesson the Hub doesn't have, and says what's missing", async () => {
    loadAdminLesson.mockResolvedValue(detail({ hub: null, video: null, files: [] }, { bodyHtml: null, contentFetchedAt: null, thumbnailSrc: null, hasVideo: false, videoDurationSeconds: null }));
    await renderServerPage(AdminLessonPage, params);

    expect(screen.queryByRole("link", { name: "Preview" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("staff-tools")).not.toBeInTheDocument();
    expect(screen.getByText(/text hasn't been imported yet/)).toBeInTheDocument();
    expect(screen.getByText("No video on this lesson.")).toBeInTheDocument();
    expect(screen.getByText("No downloads.")).toBeInTheDocument();
    expect(screen.getByText("No thumbnail.")).toBeInTheDocument();
  });

  it("blocks Publish under a draft module, and says which to publish first", async () => {
    loadAdminLesson.mockResolvedValue(
      detail({ trail: [{ kajabiId: "m1", title: "Module 1", publishingOption: "draft" }] }, { publishingOption: "draft", state: "hidden", reason: "Draft in Kajabi" })
    );
    await renderServerPage(AdminLessonPage, params);
    expect(screen.getByRole("radio", { name: /Published/ })).toBeDisabled();
    expect(screen.getByText("(Publish “Module 1” first)")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Draft" })).toBeChecked();
  });

  it("titles the tab with the lesson, then the course", async () => {
    loadAdminLesson.mockResolvedValue(detail());
    expect(await generateMetadata(params)).toEqual({ title: "Reader Expectations vs. Reader Preferences · The Ready Writer · Courses" });
    loadAdminLesson.mockResolvedValue(null);
    expect(await generateMetadata(params)).toEqual({ title: "Courses" });
  });
});
