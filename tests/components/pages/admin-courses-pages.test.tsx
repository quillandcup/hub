// @vitest-environment jsdom
/** The admin Courses pages: the list, and one course with every lesson explained. Loaders mocked; markup is real. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderServerPage, resetServerPageMocks, useFakeSupabase } from "@/tests/helpers/server-page";
import { explainCourse } from "@/lib/courses/explain";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
const requireAdminPage = vi.fn(async () => undefined);
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: () => requireAdminPage() }));

const loadAdminCourses = vi.fn();
const loadAdminCourse = vi.fn();
vi.mock("@/lib/courses/admin", () => ({
  loadAdminCourses: (...a: unknown[]) => loadAdminCourses(...a),
  loadAdminCourse: (...a: unknown[]) => loadAdminCourse(...a),
}));
vi.mock("@/app/(admin)/admin/courses/[id]/CourseVideosPanel", () => ({
  default: (props: { slug: string | null; videos: unknown[] }) => <div data-testid="videos" data-slug={props.slug ?? ""} data-count={props.videos.length} />,
}));
vi.mock("@/app/(admin)/admin/courses/[id]/CourseFilesPanel", () => ({
  default: (props: { slug: string | null; plan: { files: unknown[] } }) => <div data-testid="files" data-slug={props.slug ?? ""} data-count={props.plan.files.length} />,
}));
vi.mock("@/app/(admin)/admin/courses/[id]/CourseSettingsForm", () => ({
  default: (props: { slug: string; accessDuration: string | null; launchOn: string }) => (
    <div data-testid="settings" data-slug={props.slug} data-access={props.accessDuration ?? "lifetime"} data-launch={props.launchOn} />
  ),
}));

vi.mock("@/app/(admin)/admin/courses/[id]/LessonStaffTools", () => ({ default: (props: { lessonId: string; preview: boolean }) => <div data-testid="staff-tools" data-lesson={props.lessonId} data-preview={String(props.preview)} /> }));

import AdminCoursesPage from "@/app/(admin)/admin/courses/page";
import AdminCoursePage from "@/app/(admin)/admin/courses/[id]/page";

const totals = { open: 0, coming_soon: 8, hidden: 45 };
const row = (over = {}) => ({
  kajabiId: "k1",
  title: "The Ready Writer",
  published: { slug: "the-ready-writer", accessDuration: "P1Y", launchAt: "2026-11-02T05:00:00Z" },
  slug: "the-ready-writer",
  access: { current: 0, upcoming: 11, ended: 0 },
  totals,
  ...over,
});

beforeEach(() => {
  resetServerPageMocks();
  useFakeSupabase();
  requireAdminPage.mockClear();
  loadAdminCourses.mockReset();
  loadAdminCourse.mockReset();
});

describe("/admin/courses", () => {
  it("checks the caller is an admin first", async () => {
    loadAdminCourses.mockResolvedValue([]);
    await renderServerPage(AdminCoursesPage, {});
    expect(requireAdminPage).toHaveBeenCalled();
  });

  it("lists each course with its Hub state, settings, lesson states and who has access", async () => {
    loadAdminCourses.mockResolvedValue([
      row(),
      row({ kajabiId: "k2", title: "Self Editing Academy", published: null, access: { current: 0, upcoming: 0, ended: 0 }, totals: { open: 0, coming_soon: 0, hidden: 138 } }),
    ]);
    await renderServerPage(AdminCoursesPage, {});

    const ready = screen.getByRole("row", { name: /The Ready Writer/ });
    expect(within(ready).getByText("Published")).toBeInTheDocument();
    expect(within(ready).getByText("1 year")).toBeInTheDocument();
    expect(within(ready).getByText("opens November 2, 2026")).toBeInTheDocument();
    expect(within(ready).getByText("0 / 8 / 45")).toBeInTheDocument();
    expect(within(ready).getByText("0 / 11 / 0")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "The Ready Writer" })).toHaveAttribute("href", "/admin/courses/k1");

    const other = screen.getByRole("row", { name: /Self Editing Academy/ });
    expect(within(other).getByText("Not published")).toBeInTheDocument();
    expect(within(other).getByText("0 / 0 / 138")).toBeInTheDocument();
  });
});

describe("/admin/courses/[id]", () => {
  const detail = (published: ReturnType<typeof row>["published"] | null = row().published, over = {}) => {
    const explained = explainCourse(
      [
        { kajabiId: "m2", parentKajabiId: null, position: 2, title: "Module 2", publishingOption: "locked" },
        { kajabiId: "w1", parentKajabiId: "m2", position: 1, title: "Week 1", publishingOption: "published" },
      ],
      [
        { kajabiId: "l1", moduleKajabiId: "w1", position: 1, title: "Reader expectations", publishingOption: "published" },
        { kajabiId: "l2", moduleKajabiId: null, position: 1, title: "Loose draft", publishingOption: "draft" },
      ]
    );
    return { course: row({ published }), explained, content: { l1: { hasText: true, hasVideo: false } }, hubLessonIds: { l1: "hub-l1", l2: "hub-l2" }, videos: [], files: { files: [], stale: [], courseId: null }, details: { description: "Learn to write.", includesMembership: true }, lastImportedAt: "2026-11-03T15:30:00Z", ...over };
  };
  const params = { params: Promise.resolve({ id: "k1" }) };

  it("is a 404 for a course Kajabi doesn't have", async () => {
    loadAdminCourse.mockResolvedValue(null);
    await expect(Promise.resolve().then(() => AdminCoursePage(params))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("explains each lesson: its state, the Kajabi setting behind it, and what the content step found", async () => {
    loadAdminCourse.mockResolvedValue(detail());
    await renderServerPage(AdminCoursePage, params);

    const lesson = screen.getByDisplayValue("Reader expectations").closest("li")!;
    expect(within(lesson).getByRole("combobox", { name: "Lesson state" })).toHaveValue("coming_soon");
    expect(within(lesson).getByText("Inside \u201cModule 2\u201d (Locked)")).toBeInTheDocument();
    expect(within(lesson).getByText("text \u2713 \u00b7 video \u2013")).toBeInTheDocument();
    const loose = screen.getByDisplayValue("Loose draft").closest("li")!;
    expect(within(loose).getByRole("combobox", { name: "Lesson state" })).toHaveValue("hidden");
    expect(within(loose).getByText("Draft in Kajabi")).toBeInTheDocument();
    expect(screen.getByText(/0 lessons\s+open, 1 coming soon, 1 hidden/)).toBeInTheDocument();
  });

  it("is the course builder: the course as last imported, with every field disabled and the support banner above", async () => {
    loadAdminCourse.mockResolvedValue(detail());
    await renderServerPage(AdminCoursePage, params);

    expect(screen.getByText(/contact support at/)).toBeInTheDocument();
    expect(screen.getByText(/Last imported from Kajabi November 3, 2026 at 10:30 AM/)).toBeInTheDocument();
    const form = screen.getByRole("form", { name: "Course builder" });
    expect(within(form).getByDisplayValue("The Ready Writer")).toBeDisabled();
    expect(within(form).getByDisplayValue("the-ready-writer")).toBeDisabled();
    expect(within(form).getByDisplayValue("Learn to write.")).toBeDisabled();
    expect(within(form).getByDisplayValue("Module 2")).toBeDisabled();
    expect(within(form).getByDisplayValue("Week 1")).toBeDisabled();
    for (const control of form.querySelectorAll("input, select, textarea, button")) expect(control).toBeDisabled();
  });

  it("says when nothing has been imported yet", async () => {
    loadAdminCourse.mockResolvedValue(detail(undefined, { lastImportedAt: null }));
    await renderServerPage(AdminCoursePage, params);
    expect(screen.getByText(/Not imported from Kajabi yet/)).toBeInTheDocument();
  });

  it("gives each lesson that is in the Hub the staff tools, as a preview when members can't open it", async () => {
    loadAdminCourse.mockResolvedValue(detail());
    await renderServerPage(AdminCoursePage, params);

    const lesson = screen.getByDisplayValue("Reader expectations").closest("li")!;
    expect(within(lesson).getByTestId("staff-tools")).toHaveAttribute("data-lesson", "hub-l1");
    expect(within(lesson).getByTestId("staff-tools")).toHaveAttribute("data-preview", "true");
  });

  it("has no staff tools for a lesson the Hub doesn't have yet", async () => {
    loadAdminCourse.mockResolvedValue(detail(undefined, { hubLessonIds: { l1: "hub-l1" } }));
    await renderServerPage(AdminCoursePage, params);
    expect(within(screen.getByDisplayValue("Loose draft").closest("li")!).queryByTestId("staff-tools")).not.toBeInTheDocument();
  });

  it("links a coming-soon lesson and a draft to their previews in the Hub", async () => {
    loadAdminCourse.mockResolvedValue(detail());
    await renderServerPage(AdminCoursePage, params);

    const soon = screen.getByDisplayValue("Reader expectations").closest("li")!;
    expect(within(soon).getByRole("link", { name: "Preview" })).toHaveAttribute("href", "/courses/the-ready-writer/lessons/hub-l1");
    // Drafts are stored in the Hub too (hidden from members), so staff preview them the same way.
    const draft = screen.getByDisplayValue("Loose draft").closest("li")!;
    expect(within(draft).getByRole("link", { name: "Preview" })).toHaveAttribute("href", "/courses/the-ready-writer/lessons/hub-l2");
  });

  it("has no link for a draft the Hub doesn't have yet (before the next sync)", async () => {
    loadAdminCourse.mockResolvedValue(detail(undefined, { hubLessonIds: { l1: "hub-l1" } }));
    await renderServerPage(AdminCoursePage, params);

    expect(within(screen.getByDisplayValue("Loose draft").closest("li")!).queryByRole("link")).not.toBeInTheDocument();
  });

  it("has no lesson links for an unpublished course", async () => {
    loadAdminCourse.mockResolvedValue(detail(null, { hubLessonIds: {} }));
    await renderServerPage(AdminCoursePage, params);

    expect(within(screen.getByDisplayValue("Reader expectations").closest("li")!).queryByRole("link")).not.toBeInTheDocument();
  });

  it("gives a published course its settings form with the launch day in the organisation's timezone", async () => {
    loadAdminCourse.mockResolvedValue(detail());
    await renderServerPage(AdminCoursePage, params);

    expect(screen.getByTestId("settings")).toHaveAttribute("data-slug", "the-ready-writer");
    expect(screen.getByTestId("settings")).toHaveAttribute("data-access", "P1Y");
    expect(screen.getByTestId("settings")).toHaveAttribute("data-launch", "2026-11-02");
    expect(screen.getByText(/11 start later/)).toBeInTheDocument();
  });

  it("links a published course to its watch stats and to who's where", async () => {
    loadAdminCourse.mockResolvedValue(detail());
    await renderServerPage(AdminCoursePage, params);
    expect(screen.getByRole("link", { name: "Watch stats" })).toHaveAttribute("href", expect.stringMatching(/^\/admin\/courses\/.+\/stats$/));
    expect(screen.getByRole("link", { name: "Who's where" })).toHaveAttribute("href", expect.stringMatching(/^\/admin\/courses\/.+\/roster$/));
  });

  it("links an unpublished course to neither", async () => {
    loadAdminCourse.mockResolvedValue(detail(null));
    await renderServerPage(AdminCoursePage, params);
    expect(screen.queryByRole("link", { name: "Watch stats" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Who's where" })).not.toBeInTheDocument();
  });

  it("gives the course's videos to the videos panel, with the slug only once it's published", async () => {
    loadAdminCourse.mockResolvedValue(detail(undefined, { videos: [{ mediaId: "m1" }, { mediaId: "m2" }] }));
    await renderServerPage(AdminCoursePage, params);
    expect(screen.getByTestId("videos")).toHaveAttribute("data-count", "2");
    expect(screen.getByTestId("videos")).toHaveAttribute("data-slug", "the-ready-writer");
  });

  it("gives the course's downloads to the files panel", async () => {
    loadAdminCourse.mockResolvedValue(detail(undefined, { files: { files: [{ kajabiFileId: "f1" }], stale: [], courseId: "c" } }));
    await renderServerPage(AdminCoursePage, params);
    expect(screen.getByTestId("files")).toHaveAttribute("data-count", "1");
    expect(screen.getByTestId("files")).toHaveAttribute("data-slug", "the-ready-writer");
  });

  it("points an unpublished course at the import page instead of a form", async () => {
    loadAdminCourse.mockResolvedValue(detail(null));
    await renderServerPage(AdminCoursePage, params);

    expect(screen.queryByTestId("settings")).not.toBeInTheDocument();
    expect(screen.getByText(/Not published yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Import Data" })).toHaveAttribute("href", "/admin/data/import");
  });
});
