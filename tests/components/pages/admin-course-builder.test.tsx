// @vitest-environment jsdom
/** The new-course page: a form for a course the Hub owns, with the programs to choose from. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderServerPage, resetServerPageMocks, useFakeSupabase } from "@/tests/helpers/server-page";
import { ACCESS_OPTIONS } from "@/lib/courses/access-options";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
const requireAdminPage = vi.fn(async () => undefined);
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: () => requireAdminPage() }));
const names = vi.fn();
vi.mock("@/lib/data/repos", () => ({ createRepos: () => ({ programs: { names: () => names() } }) }));
vi.mock("@/app/(admin)/admin/courses/actions", () => ({ createCourse: vi.fn(), updateCourseDetails: vi.fn() }));

import NewCoursePage from "@/app/(admin)/admin/courses/new/page";

beforeEach(() => {
  resetServerPageMocks();
  useFakeSupabase();
  requireAdminPage.mockClear();
  names.mockReset();
  names.mockResolvedValue([
    { id: "prg_AAAAAAAAAAA1", name: "180 Program" },
    { id: "prg_AAAAAAAAAAA2", name: "Self-Editing Academy" },
  ]);
});

describe("/admin/courses/new", () => {
  it("checks the caller is an admin first", async () => {
    await renderServerPage(NewCoursePage, {});
    expect(requireAdminPage).toHaveBeenCalled();
  });

  it("is a blank form for a Hub-owned course, with no choice of access length made for you", async () => {
    await renderServerPage(NewCoursePage, {});
    const form = screen.getByRole("form", { name: "New course" });
    expect(within(form).getByLabelText("Name")).toHaveValue("");
    const access = within(form).getByLabelText("Access length") as HTMLSelectElement;
    expect(access.value).toBe("");
    expect(within(access).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose…", ...ACCESS_OPTIONS.map((o) => o.label)]);
    expect(within(form).getByRole("button", { name: "Create course" })).toBeEnabled();
    // Not the Kajabi notice: this course isn't imported.
    expect(screen.queryByText(/contact support/)).not.toBeInTheDocument();
  });

  it("offers the programs, or none", async () => {
    await renderServerPage(NewCoursePage, {});
    const program = screen.getByLabelText("Program");
    expect(within(program).getAllByRole("option").map((o) => o.textContent)).toEqual(["None", "180 Program", "Self-Editing Academy"]);
  });
});
