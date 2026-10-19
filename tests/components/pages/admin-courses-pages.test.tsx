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
vi.mock("@/app/(admin)/admin/courses/[id]/CourseSettingsForm", () => ({
  default: (props: { slug: string; accessDuration: string | null; launchOn: string }) => (
    <div data-testid="settings" data-slug={props.slug} data-access={props.accessDuration ?? "lifetime"} data-launch={props.launchOn} />
  ),
}));

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
    return { course: row({ published }), explained, content: { l1: { hasText: true, hasVideo: false } }, hubLessonIds: { l1: "hub-l1", l2: "hub-l2" }, ...over };
  };
  const params = { params: Promise.resolve({ id: "k1" }) };

  it("is a 404 for a course Kajabi doesn't have", async () => {
    loadAdminCourse.mockResolvedValue(null);
    await expect(Promise.resolve().then(() => AdminCoursePage(params))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("explains each lesson: its state, the Kajabi setting behind it, and what the content step found", async () => {
    loadAdminCourse.mockResolvedValue(detail());
    await renderServerPage(AdminCoursePage, params);

    const lesson = screen.getByText("Reader expectations").closest("li")!;
    expect(within(lesson).getByText("Coming soon")).toBeInTheDocument();
    expect(within(lesson).getByText("Inside “Module 2” (Locked)")).toBeInTheDocument();
    expect(within(lesson).getByText("text ✓ · video –")).toBeInTheDocument();
    const loose = screen.getByText("Loose draft").closest("li")!;
    expect(within(loose).getByText("Hidden")).toBeInTheDocument();
    expect(within(loose).getByText("Draft in Kajabi")).toBeInTheDocument();
    expect(screen.getByText(/1 open|0 open, 1 coming soon, 1 hidden/)).toBeInTheDocument();
  });

  it("links a coming-soon lesson to its preview in the Hub, and nothing for a hidden one", async () => {
    loadAdminCourse.mockResolvedValue(detail());
    await renderServerPage(AdminCoursePage, params);

    const soon = screen.getByText("Reader expectations").closest("li")!;
    expect(within(soon).getByRole("link", { name: "Preview" })).toHaveAttribute("href", "/courses/the-ready-writer/lessons/hub-l1");
    expect(within(screen.getByText("Loose draft").closest("li")!).queryByRole("link")).not.toBeInTheDocument();
  });

  it("has no lesson links for an unpublished course", async () => {
    loadAdminCourse.mockResolvedValue(detail(null, { hubLessonIds: {} }));
    await renderServerPage(AdminCoursePage, params);

    expect(within(screen.getByText("Reader expectations").closest("li")!).queryByRole("link")).not.toBeInTheDocument();
  });

  it("gives a published course its settings form with the launch day in the organisation's timezone", async () => {
    loadAdminCourse.mockResolvedValue(detail());
    await renderServerPage(AdminCoursePage, params);

    expect(screen.getByTestId("settings")).toHaveAttribute("data-slug", "the-ready-writer");
    expect(screen.getByTestId("settings")).toHaveAttribute("data-access", "P1Y");
    expect(screen.getByTestId("settings")).toHaveAttribute("data-launch", "2026-11-02");
    expect(screen.getByText(/11 start later/)).toBeInTheDocument();
  });

  it("points an unpublished course at the import page instead of a form", async () => {
    loadAdminCourse.mockResolvedValue(detail(null));
    await renderServerPage(AdminCoursePage, params);

    expect(screen.queryByTestId("settings")).not.toBeInTheDocument();
    expect(screen.getByText(/Not published yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Import Data" })).toHaveAttribute("href", "/admin/data/import");
  });
});
