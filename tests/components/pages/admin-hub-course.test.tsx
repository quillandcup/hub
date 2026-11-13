// @vitest-environment jsdom
/** The admin page of a Hub-owned course (an id like crs_…): its details, editable. A Kajabi course keeps the read-only builder. Loaders mocked; markup is real. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderServerRoute, resetServerPageMocks } from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
const loadCourseRoster = vi.fn();
vi.mock("@/lib/courses/roster-data", () => ({ loadCourseRoster: (...a: unknown[]) => loadCourseRoster(...a) }));
const requireAdminPage = vi.fn(async () => undefined);
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: () => requireAdminPage() }));
const loadHubCourse = vi.fn();
const loadHubOutline = vi.fn();
const loadAdminCourse = vi.fn();
const loadAdminCourseTitle = vi.fn();
vi.mock("@/lib/courses/admin", () => ({
  loadHubCourse: (...a: unknown[]) => loadHubCourse(...a),
  loadHubOutline: (...a: unknown[]) => loadHubOutline(...a),
  loadAdminCourse: (...a: unknown[]) => loadAdminCourse(...a),
  loadAdminCourseTitle: (...a: unknown[]) => loadAdminCourseTitle(...a),
}));
vi.mock("@/lib/data/repos", () => ({
  createRepos: () => ({
    programs: {
      names: async () => [
        { id: "prg_AAAAAAAAAAA1", name: "180 Program" },
        { id: "prg_AAAAAAAAAAA2", name: "Self-Editing Academy" },
      ],
    },
  }),
}));
const loadDuplicatePreview = vi.fn();
vi.mock("@/lib/courses/duplicate", () => ({ loadDuplicatePreview: (...a: unknown[]) => loadDuplicatePreview(...a) }));
vi.mock("@/app/(admin)/admin/courses/duplicate-actions", () => ({ duplicateCourse: vi.fn() }));
vi.mock("@/app/(admin)/admin/courses/take-over-actions", () => ({ takeOverCourse: vi.fn() }));
vi.mock("@/app/(admin)/admin/courses/actions", () => ({ createCourse: vi.fn(), updateCourseDetails: vi.fn() }));
vi.mock("@/app/(admin)/admin/courses/outline-actions", () => ({
  addCourseLesson: vi.fn(),
  addCourseModule: vi.fn(),
  deleteCourseItem: vi.fn(),
  duplicateCourseItem: vi.fn(),
  renameCourseItem: vi.fn(),
  reorderCourseItems: vi.fn(),
}));

import { buildHubOutline } from "@/lib/courses/hub-outline";
import AdminCoursePage, { generateMetadata } from "@/app/(admin)/admin/courses/[id]/page";
import AdminCourseDetailsPage from "@/app/(admin)/admin/courses/[id]/details/page";
import AdminCourseMediaPage from "@/app/(admin)/admin/courses/[id]/media/page";

const COURSE = "crs_AAAAAAAAAAA1";
const params = (id = COURSE) => ({ params: Promise.resolve({ id }) });
const course = (over: Record<string, unknown> = {}) => ({
  id: COURSE,
  title: "Plot Lab",
  slug: "plot-lab",
  description: "Plan a plot.",
  accessDuration: "1 year",
  launchAt: "2026-11-02T05:00:00Z",
  programId: "prg_AAAAAAAAAAA2",
  publishingOption: "published",
  access: { current: 3, upcoming: 2, ended: 1 },
  ...over,
});

beforeEach(() => {
  resetServerPageMocks();
  loadCourseRoster.mockReset();
  loadCourseRoster.mockResolvedValue({ course: { id: "c", title: "C" }, rows: [{}, {}, {}] });
  requireAdminPage.mockClear();
  loadHubCourse.mockReset();
  loadHubOutline.mockReset();
  loadHubOutline.mockResolvedValue(buildHubOutline([], []));
  loadAdminCourse.mockReset();
  loadAdminCourseTitle.mockReset();
});

describe("/admin/courses/[id] for a Hub-owned course", () => {
  it("checks the caller is an admin first, and shows the Hub course when the id is not a Kajabi import", async () => {
    loadHubCourse.mockResolvedValue(course());
    await renderServerRoute(AdminCoursePage, params());
    expect(requireAdminPage).toHaveBeenCalled();
    expect(loadHubCourse).toHaveBeenCalledWith(expect.anything(), COURSE);
    expect(loadAdminCourse).toHaveBeenCalledWith(expect.anything(), COURSE);
  });

  it("shows the course's address, who has access and when it opens, and the details to edit", async () => {
    loadHubCourse.mockResolvedValue(course());
    const { unmount } = await renderServerRoute(AdminCoursePage, params());

    expect(screen.getByRole("heading", { level: 1, name: "Plot Lab" })).toBeInTheDocument();
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.getByText("In the Hub")).toBeInTheDocument();
    expect(screen.getByText("/courses/plot-lab")).toBeInTheDocument();
    expect(screen.getByText(/3 have access now, 2 start later,\s+1 have ended/)).toBeInTheDocument();
    expect(screen.getByText(/It opens November 2, 2026/)).toBeInTheDocument();
    unmount();

    await renderServerRoute(AdminCourseDetailsPage, params());

    const form = screen.getByRole("form", { name: "Course details" });
    expect(within(form).getByLabelText("Name")).toHaveValue("Plot Lab");
    expect(within(form).getByLabelText("Address")).toHaveValue("plot-lab");
    expect(within(form).getByLabelText("Description")).toHaveValue("Plan a plot.");
    expect(within(form).getByLabelText("Access length")).toHaveValue("1");
    expect(within(form).getByLabelText("Opens")).toHaveValue("2026-11-02");
    expect(within(form).getByLabelText("Program")).toHaveValue("prg_AAAAAAAAAAA2");
    expect(within(form).getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("has the Outline and Details tabs only (no media tab until the Hub has media to manage), and no take over", async () => {
    loadDuplicatePreview.mockResolvedValue({ modules: 1, lessons: 2, withVideo: 0, downloads: 0, tooDeep: false });
    loadHubCourse.mockResolvedValue(course());
    await renderServerRoute(AdminCoursePage, params());
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Outline", "Details", "Customers (3)"]);
    expect(screen.getByRole("tab", { name: "Outline" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("button", { name: "Course actions" }));
    expect(screen.queryByRole("menuitem", { name: /Take over/ })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Watch stats" })).toBeInTheDocument();
  });

  it("opens the Details tab at its own path, and has no Media tab", async () => {
    loadHubCourse.mockResolvedValue(course());
    await renderServerRoute(AdminCourseDetailsPage, params());
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    await expect(renderServerRoute(AdminCourseMediaPage, params())).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("offers to duplicate the course from the menu", async () => {
    loadDuplicatePreview.mockResolvedValue({ modules: 1, lessons: 2, withVideo: 0, downloads: 0, tooDeep: false });
    loadHubCourse.mockResolvedValue(course());
    await renderServerRoute(AdminCoursePage, params());
    await userEvent.click(screen.getByRole("button", { name: "Course actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Duplicate course" }));
    expect(screen.getByRole("dialog", { name: "Duplicate this course?" })).toHaveTextContent(/Plot Lab \(copy\)/);
  });

  it("isn't the read-only Kajabi builder: no support notice, and the outline can be changed", async () => {
    loadHubCourse.mockResolvedValue(course());
    await renderServerRoute(AdminCoursePage, params());
    expect(screen.queryByText(/contact support/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add module" })).toBeEnabled();
  });

  it("shows the course's own modules and lessons in the outline, previewed at its address", async () => {
    loadHubCourse.mockResolvedValue(course());
    loadHubOutline.mockResolvedValue(
      buildHubOutline(
        [{ id: "mod_AAAAAAAAAAA1", parent_id: null, title: "Module 1", position: 1, publishing_option: "published" }],
        [{ id: "les_AAAAAAAAAAA1", module_id: "mod_AAAAAAAAAAA1", title: "Lesson one", position: 1, publishing_option: "published", hasText: false, hasVideo: false }]
      )
    );
    await renderServerRoute(AdminCoursePage, params());

    expect(loadHubOutline).toHaveBeenCalledWith(expect.anything(), COURSE);
    expect(screen.getByText("1 Module")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Expand Module 1" }));
    expect(screen.getByText("Lesson one")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open lesson preview" })).toHaveAttribute("href", "/courses/plot-lab/lessons/les_AAAAAAAAAAA1");
  });

  it("says there are no modules yet for a new course", async () => {
    loadHubCourse.mockResolvedValue(course());
    await renderServerRoute(AdminCoursePage, params());
    expect(screen.getByText("No modules yet.")).toBeInTheDocument();
  });

  it("opens straight away with no day and no program set, and leaves access to be chosen when it isn't one of the options", async () => {
    loadHubCourse.mockResolvedValue(course({ launchAt: null, programId: null, description: null, accessDuration: "P2Y" }));
    await renderServerRoute(AdminCourseDetailsPage, params());
    const form = screen.getByRole("form", { name: "Course details" });
    expect(within(form).getByLabelText("Opens")).toHaveValue("");
    expect(within(form).getByLabelText("Program")).toHaveValue("");
    expect(within(form).getByLabelText("Description")).toHaveValue("");
    expect(within(form).getByLabelText("Access length")).toHaveValue("");
    expect(screen.queryByText(/It opens/)).not.toBeInTheDocument();
  });

  it("is a 404 for a Hub id that isn't a Hub-owned course (unknown, or imported from Kajabi)", async () => {
    loadHubCourse.mockResolvedValue(null);
    await expect(renderServerRoute(AdminCoursePage, params())).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });
});

describe("the tab for a Hub-owned course", () => {
  it("names the course, like an imported one", async () => {
    loadAdminCourseTitle.mockResolvedValue("Plot Lab");
    expect(await generateMetadata(params())).toEqual({ title: "Plot Lab · Courses" });
    expect(loadAdminCourseTitle).toHaveBeenCalledWith(expect.anything(), COURSE);
  });
});
