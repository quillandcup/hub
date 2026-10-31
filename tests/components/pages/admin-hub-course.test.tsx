// @vitest-environment jsdom
/** The admin page of a Hub-owned course (an id like crs_…): its details, editable. A Kajabi course keeps the read-only builder. Loaders mocked; markup is real. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderServerRoute, resetServerPageMocks, useFakeSupabase } from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
const requireAdminPage = vi.fn(async () => undefined);
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: () => requireAdminPage() }));
const loadHubCourse = vi.fn();
const loadAdminCourse = vi.fn();
const loadAdminCourseTitle = vi.fn();
vi.mock("@/lib/courses/admin", () => ({
  loadHubCourse: (...a: unknown[]) => loadHubCourse(...a),
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
vi.mock("@/app/(admin)/admin/courses/actions", () => ({ createCourse: vi.fn(), updateCourseDetails: vi.fn() }));

import AdminCoursePage, { generateMetadata } from "@/app/(admin)/admin/courses/[id]/page";

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
  access: { current: 3, upcoming: 2, ended: 1 },
  ...over,
});

beforeEach(() => {
  resetServerPageMocks();
  useFakeSupabase();
  requireAdminPage.mockClear();
  loadHubCourse.mockReset();
  loadAdminCourse.mockReset();
  loadAdminCourseTitle.mockReset();
});

describe("/admin/courses/[id] for a Hub-owned course", () => {
  it("checks the caller is an admin first, and reads the Hub course, not the Kajabi import", async () => {
    loadHubCourse.mockResolvedValue(course());
    await renderServerRoute(AdminCoursePage, params());
    expect(requireAdminPage).toHaveBeenCalled();
    expect(loadHubCourse).toHaveBeenCalledWith(expect.anything(), COURSE);
    expect(loadAdminCourse).not.toHaveBeenCalled();
  });

  it("shows the course's address, who has access and when it opens, and the details to edit", async () => {
    loadHubCourse.mockResolvedValue(course());
    await renderServerRoute(AdminCoursePage, params());

    expect(screen.getByRole("heading", { name: "Plot Lab" })).toBeInTheDocument();
    expect(screen.getByText("/courses/plot-lab")).toBeInTheDocument();
    expect(screen.getByText(/3 have access now, 2 start later,\s+1 have ended/)).toBeInTheDocument();
    expect(screen.getByText(/It opens November 2, 2026/)).toBeInTheDocument();

    const form = screen.getByRole("form", { name: "Course details" });
    expect(within(form).getByLabelText("Name")).toHaveValue("Plot Lab");
    expect(within(form).getByLabelText("Address")).toHaveValue("plot-lab");
    expect(within(form).getByLabelText("Description")).toHaveValue("Plan a plot.");
    expect(within(form).getByLabelText("Access length")).toHaveValue("1");
    expect(within(form).getByLabelText("Opens")).toHaveValue("2026-11-02");
    expect(within(form).getByLabelText("Program")).toHaveValue("prg_AAAAAAAAAAA2");
    expect(within(form).getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("isn't the read-only Kajabi builder: no support notice, and says modules and lessons can't be added yet", async () => {
    loadHubCourse.mockResolvedValue(course());
    await renderServerRoute(AdminCoursePage, params());
    expect(screen.queryByText(/contact support/)).not.toBeInTheDocument();
    expect(screen.getByText("Modules and lessons can't be added here yet.")).toBeInTheDocument();
  });

  it("opens straight away with no day and no program set, and leaves access to be chosen when it isn't one of the options", async () => {
    loadHubCourse.mockResolvedValue(course({ launchAt: null, programId: null, description: null, accessDuration: "P2Y" }));
    await renderServerRoute(AdminCoursePage, params());
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
