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
const loadAdminCourseTitle = vi.fn();
vi.mock("@/lib/courses/admin", () => ({
  loadAdminCourses: (...a: unknown[]) => loadAdminCourses(...a),
  loadAdminCourse: (...a: unknown[]) => loadAdminCourse(...a),
  loadAdminCourseTitle: (...a: unknown[]) => loadAdminCourseTitle(...a),
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

import AdminCoursesPage from "@/app/(admin)/admin/courses/page";
import AdminCoursePage, { generateMetadata } from "@/app/(admin)/admin/courses/[id]/page";

const totals = { open: 0, coming_soon: 8, hidden: 45 };
const row = (over = {}) => ({
  id: "crs_AAAAAAAAAAA1",
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
      row({ id: null, title: "Self Editing Academy", published: null, access: { current: 0, upcoming: 0, ended: 0 }, totals: { open: 0, coming_soon: 0, hidden: 138 } }),
    ]);
    await renderServerPage(AdminCoursesPage, {});

    const ready = screen.getByRole("row", { name: /The Ready Writer/ });
    expect(within(ready).getByText("Published")).toBeInTheDocument();
    expect(within(ready).getByText("1 year")).toBeInTheDocument();
    expect(within(ready).getByText("opens November 2, 2026")).toBeInTheDocument();
    expect(within(ready).getByText("0 / 8 / 45")).toBeInTheDocument();
    expect(within(ready).getByText("0 / 11 / 0")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "The Ready Writer" })).toHaveAttribute("href", "/admin/courses/crs_AAAAAAAAAAA1");

    const other = screen.getByRole("row", { name: /Self Editing Academy/ });
    expect(within(other).getByText("Not published")).toBeInTheDocument();
    // No Hub row yet (the Kajabi import makes it), so there is no id to link by, and never a Kajabi one.
    expect(within(other).queryByRole("link")).not.toBeInTheDocument();
    expect(within(other).getByText("0 / 0 / 138")).toBeInTheDocument();
  });
});

describe("/admin/courses, Hub-owned courses", () => {
  it("marks a course the Hub owns, and links it by its own id", async () => {
    loadAdminCourses.mockResolvedValue([
      row({ source: "kajabi" }),
      row({ source: "hub", id: "crs_AAAAAAAAAAA2", title: "Plot Lab", published: { slug: "plot-lab", accessDuration: "1 year", launchAt: null }, totals: { open: 2, coming_soon: 1, hidden: 0 } }),
    ]);
    await renderServerPage(AdminCoursesPage, {});

    const hub = screen.getByRole("row", { name: /Plot Lab/ });
    expect(within(hub).getByText("Hub")).toBeInTheDocument();
    expect(within(hub).getByRole("link", { name: "Plot Lab" })).toHaveAttribute("href", "/admin/courses/crs_AAAAAAAAAAA2");
    expect(within(hub).getByText("2 / 1 / 0")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /The Ready Writer/ })).queryByText("Hub")).not.toBeInTheDocument();
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
  const params = { params: Promise.resolve({ id: "crs_AAAAAAAAAAA1" }) };

  it("is a 404 for an id that is not a course id", async () => {
    await expect(Promise.resolve().then(() => AdminCoursePage({ params: Promise.resolve({ id: "2149594995" }) }))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("is the course builder: the course as last imported, with its fields disabled and the support banner above", async () => {
    loadAdminCourse.mockResolvedValue(detail());
    await renderServerPage(AdminCoursePage, params);

    expect(screen.getByText(/contact support at/)).toBeInTheDocument();
    expect(screen.getByText(/Last imported from Kajabi November 3, 2026 at 10:30 AM/)).toBeInTheDocument();
    const form = screen.getByRole("form", { name: "Course builder" });
    expect(within(form).getByDisplayValue("The Ready Writer")).toBeDisabled();
    expect(within(form).getByDisplayValue("the-ready-writer")).toBeDisabled();
    expect(within(form).getByDisplayValue("Learn to write.")).toBeDisabled();
    expect(within(form).getByText("Module 2")).toBeInTheDocument();
    for (const control of form.querySelectorAll("input:not([type=search]), select, textarea, button")) {
      if (control.textContent?.match(/(Expand|Collapse) all/) || control.getAttribute("aria-label")?.match(/^(Expand|Collapse) /)) continue;
      if (control.closest("a")) continue;
      expect(control, control.outerHTML).toBeDisabled();
    }
  });

  it("puts the course's name first in the browser tab", async () => {
    loadAdminCourseTitle.mockResolvedValue("The Ready Writer");
    expect(await generateMetadata({ params: Promise.resolve({ id: "crs_AAAAAAAAAAA1" }) })).toEqual({ title: "The Ready Writer · Courses" });
    loadAdminCourseTitle.mockResolvedValue(null);
    expect(await generateMetadata({ params: Promise.resolve({ id: "nope" }) })).toEqual({ title: "Courses" });
  });

  it("says when nothing has been imported yet", async () => {
    loadAdminCourse.mockResolvedValue(detail(undefined, { lastImportedAt: null }));
    await renderServerPage(AdminCoursePage, params);
    expect(screen.getByText(/Not imported from Kajabi yet/)).toBeInTheDocument();
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
