// @vitest-environment jsdom
/** One lesson's builder page: the lesson as last imported, every change control disabled. Loader mocked; markup is real. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderServerPage, resetServerPageMocks } from "@/tests/helpers/server-page";
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

const publicLessonPreview = vi.fn();
vi.mock("@/lib/courses/public-preview", () => ({ publicLessonPreview: (...a: unknown[]) => publicLessonPreview(...a) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
const signPlaybackTokens = vi.fn();
vi.mock("@/lib/mux", () => ({ createMuxClient: () => ({}), signPlaybackTokens: (...a: unknown[]) => signPlaybackTokens(...a) }));
vi.mock("@/components/courses/LessonPlayer", () => ({
  default: (props: { title: string; playbackId: string; posterUrl?: string | null; trackProgress?: boolean }) => (
    <div data-testid="player" data-playback={props.playbackId} data-poster={props.posterUrl ?? ""} data-tracking={String(!!props.trackProgress)} />
  ),
}));

import AdminLessonPage, { generateMetadata } from "@/app/(admin)/admin/courses/[id]/lessons/[lessonId]/page";

const detail = (over: Partial<AdminLessonDetail> = {}, lesson: Partial<AdminLessonDetail["lesson"]> = {}): AdminLessonDetail => ({
  course: { id: "crs_AAAAAAAAAAA1", title: "The Ready Writer" },
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
  files: [{ id: null, filename: "Tracker_Sheet.pdf", sizeBytes: 2048 }],
  hub: { slug: "the-ready-writer", lessonId: "les_AAAAAAAAAAA1" },
  video: { status: "ready", playbackId: "pb1" },
  editable: false,
  ...over,
});
const params = { params: Promise.resolve({ id: "crs_AAAAAAAAAAA1", lessonId: "les_AAAAAAAAAAA1" }) };

beforeEach(() => {
  resetServerPageMocks();
  requireAdminPage.mockClear();
  loadAdminLesson.mockReset();
  publicLessonPreview.mockReset();
  publicLessonPreview.mockResolvedValue({ preview: { lessonId: "les_AAAAAAAAAAA1", title: "Reader Expectations vs. Reader Preferences", excerpt: null, courseSlug: "the-ready-writer", courseTitle: "The Ready Writer", thumbnailSrc: "/api/courses/image/lesson/les_AAAAAAAAAAA1" } });
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
    expect(within(form).getByText(/Members see it as coming soon. Inside “Module 2” \(Locked\)\./)).toBeInTheDocument();
  });

  it("shows a Hub-owned lesson with its title and status ready to change, and no line about a Kajabi import", async () => {
    loadAdminLesson.mockResolvedValue(detail({ editable: true }, { publishingOption: "draft" }));
    await renderServerPage(AdminLessonPage, params);

    const form = screen.getByRole("form", { name: "Lesson builder" });
    expect(within(form).getByRole("textbox", { name: "Title" })).toBeEnabled();
    expect(within(form).getByRole("radio", { name: "Draft" })).toBeChecked();
    expect(within(form).getByRole("radio", { name: "Published" })).toBeEnabled();
    expect(screen.queryByText(/Last imported from Kajabi/)).not.toBeInTheDocument();
  });

  it("gives a Hub-owned lesson the buttons to upload, replace and remove its video, and an imported one none", async () => {
    loadAdminLesson.mockResolvedValue(detail({ editable: true }));
    const { unmount } = await renderServerPage(AdminLessonPage, params);
    expect(screen.getByRole("button", { name: "Replace video" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove video" })).toBeInTheDocument();
    unmount();

    loadAdminLesson.mockResolvedValue(detail({ editable: true, video: null }, { hasVideo: false }));
    const { unmount: second } = await renderServerPage(AdminLessonPage, params);
    expect(screen.getByRole("button", { name: "Upload video" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove video" })).not.toBeInTheDocument();
    second();

    loadAdminLesson.mockResolvedValue(detail({ editable: false }));
    await renderServerPage(AdminLessonPage, params);
    expect(screen.queryByRole("button", { name: /video$/ })).toBeNull();
  });

  it("lets a Hub-owned lesson's downloads be added and removed, and shows an imported lesson's as they are", async () => {
    loadAdminLesson.mockResolvedValue(detail({ editable: true, files: [{ id: "file_AAAAAAAAAAA1", filename: "Tracker_Sheet.pdf", sizeBytes: 2048 }] }));
    const { unmount } = await renderServerPage(AdminLessonPage, params);
    expect(screen.getByRole("button", { name: "Add files" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Remove Tracker_Sheet.pdf" })).toBeEnabled();
    unmount();

    loadAdminLesson.mockResolvedValue(detail({ editable: false }));
    await renderServerPage(AdminLessonPage, params);
    expect(screen.getByText("Tracker_Sheet.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add files" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^Remove / })).not.toBeInTheDocument();
  });

  it("gives a Hub-owned lesson an editor for its text, and an imported one only the text", async () => {
    loadAdminLesson.mockResolvedValue(detail({ editable: true }, { bodyHtml: "<p>Hey Hedgies</p>" }));
    const { unmount } = await renderServerPage(AdminLessonPage, params);
    expect(await screen.findByRole("textbox", { name: "Lesson text" })).toHaveTextContent("Hey Hedgies");
    expect(screen.getByRole("button", { name: "Save text" })).toBeInTheDocument();
    unmount();

    loadAdminLesson.mockResolvedValue(detail({ editable: false }));
    await renderServerPage(AdminLessonPage, params);
    expect(screen.getByText("Hey Hedgies")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Lesson text" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save text" })).not.toBeInTheDocument();
  });

  it("plays the lesson's video in the builder with the members' player, poster from the lesson thumbnail and no watch tracking", async () => {
    loadAdminLesson.mockResolvedValue(detail());
    await renderServerPage(AdminLessonPage, params);

    expect(signPlaybackTokens).toHaveBeenCalledWith(expect.anything(), "pb1");
    expect(screen.getByTestId("player")).toHaveAttribute("data-playback", "pb1");
    expect(screen.getByTestId("player")).toHaveAttribute("data-poster", "https://example.com/t.jpg");
    expect(screen.getByTestId("player")).toHaveAttribute("data-tracking", "false");
  });

  it("offers Video actions beside the video, with the lesson's stats and its address for members", async () => {
    const user = userEvent.setup();
    loadAdminLesson.mockResolvedValue(detail());
    await renderServerPage(AdminLessonPage, params);

    await user.click(screen.getByRole("button", { name: /Video actions/ }));
    expect(screen.getByRole("menuitem", { name: "Video stats" })).toHaveAttribute("href", "/admin/courses/crs_AAAAAAAAAAA1/stats/les_AAAAAAAAAAA1");
    expect(screen.getByRole("menuitem", { name: "Copy timestamp URL" })).toBeEnabled();
  });

  it("enables Copy link with thumbnail for a public lesson, and says why not when it isn't (not open, no thumbnail, course not open, feature off, not in the Hub)", async () => {
    const user = userEvent.setup();
    loadAdminLesson.mockResolvedValue(detail());
    const { unmount } = await renderServerPage(AdminLessonPage, params);
    await user.click(screen.getByRole("button", { name: /Video actions/ }));
    expect(screen.getByRole("menuitem", { name: "Copy link with thumbnail" })).toBeEnabled();
    expect(publicLessonPreview).toHaveBeenCalledWith(expect.anything(), "les_AAAAAAAAAAA1");
    unmount();

    const cases: [unknown, RegExp][] = [
      [{ blocked: "not_open" }, /open to members/],
      [{ blocked: "course_not_live" }, /hasn't opened/],
      [{ blocked: "feature_off" }, /aren't on for everyone/],
      [{ preview: { lessonId: "x", title: "T", excerpt: null, courseSlug: "s", courseTitle: "C", thumbnailSrc: null } }, /no thumbnail/],
    ];
    for (const [result, reason] of cases) {
      publicLessonPreview.mockResolvedValue(result);
      loadAdminLesson.mockResolvedValue(detail());
      const view = await renderServerPage(AdminLessonPage, params);
      await user.click(screen.getByRole("button", { name: /Video actions/ }));
      const item = screen.getByRole("menuitem", { name: "Copy link with thumbnail" });
      expect(item).toBeDisabled();
      expect(item).toHaveAttribute("title", expect.stringMatching(reason));
      view.unmount();
    }

    loadAdminLesson.mockResolvedValue(detail({ hub: null, video: null }));
    await renderServerPage(AdminLessonPage, params);
    await user.click(screen.getByRole("button", { name: /Video actions/ }));
    expect(screen.getByRole("menuitem", { name: "Copy link with thumbnail" })).toHaveAttribute("title", "This lesson isn't in the Hub yet");
    expect(publicLessonPreview).toHaveBeenCalledTimes(5);
  });

  it("keeps Video actions when the video can't play, and has none for a lesson without a video", async () => {
    loadAdminLesson.mockResolvedValue(detail({ video: { status: "preparing", playbackId: null } }));
    const { unmount } = await renderServerPage(AdminLessonPage, params);
    expect(screen.getByRole("button", { name: /Video actions/ })).toBeInTheDocument();
    unmount();

    loadAdminLesson.mockResolvedValue(detail({ video: null, hub: null }));
    const second = await renderServerPage(AdminLessonPage, params);
    expect(screen.getByRole("button", { name: /Video actions/ })).toBeInTheDocument();
    second.unmount();

    loadAdminLesson.mockResolvedValue(detail({ video: null }, { hasVideo: false, videoDurationSeconds: null }));
    await renderServerPage(AdminLessonPage, params);
    expect(screen.queryByRole("button", { name: /Video actions/ })).not.toBeInTheDocument();
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
    for (const control of form.querySelectorAll("input, select, textarea, button")) {
      // The Video actions button only opens a menu (its editing items are disabled, see VideoActions.test.tsx).
      if (control.getAttribute("aria-haspopup") === "menu") continue;
      expect(control, control.outerHTML).toBeDisabled();
    }
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

  it("can be set to Published under a draft module: it waits there, and the line under says why", async () => {
    loadAdminLesson.mockResolvedValue(
      detail({ trail: [{ kajabiId: "m1", title: "Module 1", publishingOption: "draft" }] }, { publishingOption: "published", state: "hidden", reason: "Inside “Module 1” (Draft)" })
    );
    await renderServerPage(AdminLessonPage, params);
    expect(screen.getByRole("radio", { name: "Published" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Draft" })).not.toBeChecked();
    expect(screen.getByText("Members don't see it. Inside “Module 1” (Draft).")).toBeInTheDocument();
  });

  it("says what members get from a draft, once, without repeating the setting the radio already shows", async () => {
    loadAdminLesson.mockResolvedValue(detail({}, { publishingOption: "draft", state: "hidden", reason: "Draft in Kajabi" }));
    await renderServerPage(AdminLessonPage, params);
    expect(screen.getByRole("radio", { name: "Draft" })).toBeChecked();
    expect(screen.getByText("Members don't see it.")).toBeInTheDocument();
    expect(screen.queryByText(/Draft in Kajabi/)).not.toBeInTheDocument();
  });

  it("titles the tab with the lesson, then the course", async () => {
    loadAdminLesson.mockResolvedValue(detail());
    expect(await generateMetadata(params)).toEqual({ title: "Reader Expectations vs. Reader Preferences · The Ready Writer · Courses" });
    loadAdminLesson.mockResolvedValue(null);
    expect(await generateMetadata(params)).toEqual({ title: "Courses" });
  });
});
