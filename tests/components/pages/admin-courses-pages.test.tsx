// @vitest-environment jsdom
/** The admin Courses pages: the list, and one course with every lesson explained. Loaders mocked; markup is real. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderServerPage, renderServerRoute, resetServerPageMocks } from "@/tests/helpers/server-page";
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

const loadTakeOverPreview = vi.fn();
vi.mock("@/lib/courses/take-over", () => ({ loadTakeOverPreview: (...a: unknown[]) => loadTakeOverPreview(...a) }));
vi.mock("@/app/(admin)/admin/courses/take-over-actions", () => ({ takeOverCourse: vi.fn() }));

const loadDuplicatePreview = vi.fn();
vi.mock("@/lib/courses/duplicate", () => ({ loadDuplicatePreview: (...a: unknown[]) => loadDuplicatePreview(...a) }));
vi.mock("@/app/(admin)/admin/courses/duplicate-actions", () => ({ duplicateCourse: vi.fn() }));

vi.mock("@/app/(admin)/admin/courses/CoursePublishControl", () => ({
  default: (props: { courseId: string; isDraft: boolean }) => <div data-testid="publish" data-course={props.courseId} data-draft={String(props.isDraft)} />,
}));

import AdminCoursesPage from "@/app/(admin)/admin/courses/page";
import AdminCoursePage, { generateMetadata } from "@/app/(admin)/admin/courses/[id]/page";
import AdminCourseDetailsPage, { generateMetadata as detailsMetadata } from "@/app/(admin)/admin/courses/[id]/details/page";
import AdminCourseMediaPage, { generateMetadata as mediaMetadata } from "@/app/(admin)/admin/courses/[id]/media/page";
import userEvent from "@testing-library/user-event";

const totals = { open: 0, coming_soon: 8, hidden: 45 };
const row = (over = {}) => ({
  id: "crs_AAAAAAAAAAA1",
  title: "The Ready Writer",
  isDraft: false,
  hub: { slug: "the-ready-writer", accessDuration: "P1Y", launchAt: "2026-11-02T05:00:00Z" },
  slug: "the-ready-writer",
  access: { current: 0, upcoming: 11, ended: 0 },
  totals,
  ...over,
});

beforeEach(() => {
  resetServerPageMocks();
  requireAdminPage.mockClear();
  loadAdminCourses.mockReset();
  loadAdminCourse.mockReset();
  loadTakeOverPreview.mockReset();
  loadTakeOverPreview.mockResolvedValue(null);
  loadDuplicatePreview.mockReset();
  loadDuplicatePreview.mockResolvedValue({ modules: 2, lessons: 7, withVideo: 5, downloads: 1, tooDeep: false });
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
      row({ id: null, title: "Self Editing Academy", isDraft: true, hub: null, access: { current: 0, upcoming: 0, ended: 0 }, totals: { open: 0, coming_soon: 0, hidden: 138 } }),
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
    expect(within(other).getByText("Draft")).toBeInTheDocument();
    // No Hub row yet (the Kajabi import makes it), so there is no id to link by, and never a Kajabi one.
    expect(within(other).queryByRole("link")).not.toBeInTheDocument();
    expect(within(other).getByText("0 / 0 / 138")).toBeInTheDocument();
  });
});

describe("/admin/courses, Hub-owned courses", () => {
  it("marks a course the Hub owns, and links it by its own id", async () => {
    loadAdminCourses.mockResolvedValue([
      row({ source: "kajabi" }),
      row({ source: "hub", id: "crs_AAAAAAAAAAA2", title: "Plot Lab", hub: { slug: "plot-lab", accessDuration: "1 year", launchAt: null }, totals: { open: 2, coming_soon: 1, hidden: 0 } }),
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
  const detail = (hub: ReturnType<typeof row>["hub"] | null = row().hub, over = {}) => {
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
    return { course: row({ hub, isDraft: hub === null }), explained, content: { l1: { hasText: true, hasVideo: false } }, hubLessonIds: { l1: "hub-l1", l2: "hub-l2" }, videos: [], files: { files: [], stale: [], courseId: null }, details: { description: "Learn to write.", includesMembership: true }, lastImportedAt: "2026-11-03T15:30:00Z", ...over };
  };
  const params = { params: Promise.resolve({ id: "crs_AAAAAAAAAAA1" }) };
  const menu = async () => {
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Course actions" }));
    return user;
  };

  it("is a 404 for an id that is not a course id", async () => {
    await expect(renderServerRoute(AdminCoursePage, { params: Promise.resolve({ id: "2149594995" }) })).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("checks the caller is an admin on every tab", async () => {
    loadAdminCourse.mockResolvedValue(detail());
    for (const page of [AdminCoursePage, AdminCourseDetailsPage, AdminCourseMediaPage]) {
      requireAdminPage.mockClear();
      const { unmount } = await renderServerRoute(page, params);
      expect(requireAdminPage).toHaveBeenCalled();
      unmount();
    }
  });

  it("has a compact header: back link, name, state chips, access summary and the import date, with the support banner above", async () => {
    loadAdminCourse.mockResolvedValue(detail());
    await renderServerRoute(AdminCoursePage, params);

    expect(screen.getByText(/contact support at/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Courses" })).toHaveAttribute("href", "/admin/courses");
    expect(screen.getByRole("heading", { level: 1, name: "The Ready Writer" })).toBeInTheDocument();
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.getByText("Imported from Kajabi")).toBeInTheDocument();
    expect(screen.getByText(/0 have access now, 11 start later, 0 have ended/)).toBeInTheDocument();
    expect(screen.getByText(/Last imported from Kajabi November 3, 2026 at 10:30 AM/)).toBeInTheDocument();
    // The long explanation of how lessons open is in a tip, not the header.
    expect(screen.getByRole("tooltip")).toHaveTextContent(/A lesson is open only when it and every module above it are Published in Kajabi/);
  });

  it("has the Outline, Details and Media tabs, and opens on the Outline: the read-only module tree", async () => {
    loadAdminCourse.mockResolvedValue(detail());
    await renderServerRoute(AdminCoursePage, params);

    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Outline", "Details", "Media"]);
    expect(screen.getByRole("tab", { name: "Outline" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByPlaceholderText("Find module or lesson…")).toBeInTheDocument();
    expect(screen.getByText("Module 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add module" })).toBeDisabled();
    // Only the open tab is mounted.
    expect(screen.queryByTestId("videos")).not.toBeInTheDocument();
    expect(screen.queryByTestId("settings")).not.toBeInTheDocument();
  });

  it("opens on the tab its path names", async () => {
    loadAdminCourse.mockResolvedValue(detail());
    await renderServerRoute(AdminCourseDetailsPage, params);
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByPlaceholderText("Find module or lesson…")).not.toBeInTheDocument();
  });

  it("puts the course's name first in the browser tab, then the tab's name", async () => {
    loadAdminCourseTitle.mockResolvedValue("The Ready Writer");
    expect(await generateMetadata({ params: Promise.resolve({ id: "crs_AAAAAAAAAAA1" }) })).toEqual({ title: "The Ready Writer · Courses" });
    loadAdminCourseTitle.mockResolvedValue(null);
    expect(await generateMetadata({ params: Promise.resolve({ id: "nope" }) })).toEqual({ title: "Courses" });
    loadAdminCourseTitle.mockResolvedValue("The Ready Writer");
    expect(await detailsMetadata(params)).toEqual({ title: "The Ready Writer · Details · Courses" });
    expect(await mediaMetadata(params)).toEqual({ title: "The Ready Writer · Media · Courses" });
  });

  it("says when nothing has been imported yet", async () => {
    loadAdminCourse.mockResolvedValue(detail(undefined, { lastImportedAt: null }));
    await renderServerRoute(AdminCoursePage, params);
    expect(screen.getByText(/Not imported from Kajabi yet/)).toBeInTheDocument();
  });

  it("shows the details as imported, disabled, and the settings form with the launch day in the organisation's timezone", async () => {
    loadAdminCourse.mockResolvedValue(detail());
    await renderServerRoute(AdminCourseDetailsPage, params);

    expect(screen.getByTestId("settings")).toHaveAttribute("data-slug", "the-ready-writer");
    expect(screen.getByTestId("settings")).toHaveAttribute("data-access", "P1Y");
    expect(screen.getByTestId("settings")).toHaveAttribute("data-launch", "2026-11-02");
    const form = screen.getByRole("form", { name: "Course details as imported" });
    expect(within(form).getByDisplayValue("The Ready Writer")).toBeDisabled();
    expect(within(form).getByDisplayValue("the-ready-writer")).toBeDisabled();
    expect(within(form).getByDisplayValue("Learn to write.")).toBeDisabled();
    for (const control of form.querySelectorAll("input, select, textarea")) expect(control, control.outerHTML).toBeDisabled();
  });

  it("puts watch stats and who's where in the actions menu, not on the page", async () => {
    loadAdminCourse.mockResolvedValue(detail());
    await renderServerRoute(AdminCoursePage, params);
    expect(screen.queryByRole("link", { name: "Watch stats" })).not.toBeInTheDocument();
    await menu();
    expect(screen.getByRole("menuitem", { name: "Watch stats" })).toHaveAttribute("href", "/admin/courses/crs_AAAAAAAAAAA1/stats");
    expect(screen.getByRole("menuitem", { name: "Who's where" })).toHaveAttribute("href", "/admin/courses/crs_AAAAAAAAAAA1/roster");
  });

  it("lets staff publish a draft that has a Hub row", async () => {
    loadAdminCourse.mockResolvedValue({ ...detail(), course: row({ isDraft: true }) });
    await renderServerRoute(AdminCoursePage, params);
    expect(within(screen.getByRole("banner")).getByText("Draft")).toBeInTheDocument();
    expect(screen.getByTestId("publish")).toHaveAttribute("data-course", "crs_AAAAAAAAAAA1");
    expect(screen.getByTestId("publish")).toHaveAttribute("data-draft", "true");
  });

  it("offers to unpublish a published course", async () => {
    loadAdminCourse.mockResolvedValue(detail());
    await renderServerRoute(AdminCoursePage, params);
    expect(screen.getByTestId("publish")).toHaveAttribute("data-draft", "false");
  });

  it("offers to take an imported course over from the menu, once it is in the Hub, and opens what that would change", async () => {
    loadAdminCourse.mockResolvedValue(detail());
    loadTakeOverPreview.mockResolvedValue({ modules: 3, lessons: 12, withText: 0, withVideo: 0, downloads: 0, withoutSetting: 0, tooDeep: false });
    await renderServerRoute(AdminCoursePage, params);
    const user = await menu();
    await user.click(screen.getByRole("menuitem", { name: "Take over from Kajabi" }));
    expect(screen.getByRole("dialog", { name: "Take over from Kajabi?" })).toHaveTextContent(/3 modules and 12 lessons/);
  });

  it("offers nothing to take over for a course that is not in the Hub yet, or that has nothing to take over", async () => {
    loadAdminCourse.mockResolvedValue(detail(null));
    const { unmount } = await renderServerRoute(AdminCoursePage, params);
    await menu();
    expect(screen.queryByRole("menuitem", { name: /Take over/ })).not.toBeInTheDocument();
    expect(loadTakeOverPreview).not.toHaveBeenCalled();
    unmount();

    loadAdminCourse.mockResolvedValue(detail());
    loadTakeOverPreview.mockResolvedValue(null);
    await renderServerRoute(AdminCoursePage, params);
    await menu();
    expect(screen.queryByRole("menuitem", { name: /Take over/ })).not.toBeInTheDocument();
  });

  it("offers to duplicate a course that is in the Hub, and nothing for one that is not in the Hub yet", async () => {
    loadAdminCourse.mockResolvedValue(detail());
    const { unmount } = await renderServerRoute(AdminCoursePage, params);
    const user = await menu();
    await user.click(screen.getByRole("menuitem", { name: "Duplicate course" }));
    expect(screen.getByRole("dialog", { name: "Duplicate this course?" })).toHaveTextContent(/2 modules and 7 lessons/);
    unmount();

    loadAdminCourse.mockResolvedValue(detail(null));
    await renderServerRoute(AdminCoursePage, params);
    await menu();
    expect(screen.queryByRole("menuitem", { name: "Duplicate course" })).not.toBeInTheDocument();
    expect(loadDuplicatePreview).toHaveBeenCalledTimes(1);
  });

  it("keeps a course with no Hub row yet off the publish button", async () => {
    loadAdminCourse.mockResolvedValue(detail(null));
    await renderServerRoute(AdminCoursePage, params);
    expect(screen.queryByTestId("publish")).not.toBeInTheDocument();
  });

  it("gives the course's videos to the videos panel on the Media tab, with the slug only once it's published", async () => {
    loadAdminCourse.mockResolvedValue(detail(undefined, { videos: [{ mediaId: "m1" }, { mediaId: "m2" }] }));
    await renderServerRoute(AdminCourseMediaPage, params);
    expect(screen.getByRole("tab", { name: "Media" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("videos")).toHaveAttribute("data-count", "2");
    expect(screen.getByTestId("videos")).toHaveAttribute("data-slug", "the-ready-writer");
  });

  it("gives the course's downloads to the files panel on the Media tab", async () => {
    loadAdminCourse.mockResolvedValue(detail(undefined, { files: { files: [{ kajabiFileId: "f1" }], stale: [], courseId: "c" } }));
    await renderServerRoute(AdminCourseMediaPage, params);
    expect(screen.getByTestId("files")).toHaveAttribute("data-count", "1");
    expect(screen.getByTestId("files")).toHaveAttribute("data-slug", "the-ready-writer");
  });

  it("points a course with no Hub row yet at the import page instead of a form", async () => {
    loadAdminCourse.mockResolvedValue(detail(null));
    await renderServerRoute(AdminCourseDetailsPage, params);

    expect(screen.queryByTestId("settings")).not.toBeInTheDocument();
    expect(screen.getByText(/Not in the Hub yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Import Data" })).toHaveAttribute("href", "/admin/data/import");
  });
});
