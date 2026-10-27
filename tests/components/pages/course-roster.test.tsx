// @vitest-environment jsdom
/** The staff "who's where" roster page and its sortable table. The loader is mocked; markup is real. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ADMIN_USER, MEMBER_USER, expectRedirect, renderServerPage, resetServerPageMocks, signInAs, useFakeSupabase, type FakeQuery } from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));

const loadCourseRoster = vi.fn();
vi.mock("@/lib/courses/roster-data", () => ({ loadCourseRoster: (...a: unknown[]) => loadCourseRoster(...a) }));

import CourseRosterPage from "@/app/(admin)/admin/courses/[id]/roster/page";

const row = (id: string, name: string, over: object = {}) => ({
  memberId: id, name, startsAt: "2026-01-01T00:00:00Z", endsAt: null, origin: "purchase", accessActive: true,
  completed: 1, total: 4, lastLessonId: "l1", lastLessonTitle: "Reader Expectations", lastActivityAt: "2026-10-05T10:00:00Z", ...over,
});
const ROLES: Record<string, string> = { [ADMIN_USER.id]: "admin", [MEMBER_USER.id]: "member" };
const userProfiles = (q: FakeQuery) => {
  const id = q.calls.find((c) => c.method === "eq" && c.args[0] === "id")?.args[1] as string;
  return { data: ROLES[id] ? [{ role: ROLES[id] }] : [] };
};
const props = { params: Promise.resolve({ id: "kaj-1" }) };

beforeEach(() => {
  resetServerPageMocks();
  useFakeSupabase({ user_profiles: userProfiles });
  signInAs(ADMIN_USER, null);
  loadCourseRoster.mockReset();
  loadCourseRoster.mockResolvedValue({
    course: { id: "c1", title: "The Ready Writer" },
    rows: [
      row("mbr_AAAAAAAAAAA1", "Fern Example", { completed: 4 }),
      row("mbr_AAAAAAAAAAA2", "Bramble Example", { accessActive: false, endsAt: "2026-02-01T00:00:00Z", origin: "grant", lastLessonTitle: null, lastActivityAt: null, completed: 0 }),
    ],
  });
});

describe("/admin/courses/[id]/roster", () => {
  it("sends a member to /no-access", async () => {
    signInAs(MEMBER_USER, null);
    await expectRedirect(CourseRosterPage, props, "/no-access");
    expect(loadCourseRoster).not.toHaveBeenCalled();
  });

  it("lists members with progress, last lesson and access", async () => {
    await renderServerPage(CourseRosterPage, props);
    expect(screen.getByRole("heading", { level: 1, name: "Who's where" })).toBeInTheDocument();
    const fern = screen.getByRole("link", { name: "Fern Example" }).closest("tr")!;
    expect(screen.getByRole("link", { name: "Fern Example" })).toHaveAttribute("href", "/admin/members/mbr_AAAAAAAAAAA1");
    expect(within(fern).getByText("4 of 4")).toBeInTheDocument();
    expect(within(fern).getByText("Reader Expectations")).toBeInTheDocument();
    const bramble = screen.getByRole("link", { name: "Bramble Example" }).closest("tr")!;
    expect(within(bramble).getByText("Not started")).toBeInTheDocument();
    expect(within(bramble).getByText(/Ended/)).toBeInTheDocument();
  });

  it("sorts by member name when the header is clicked", async () => {
    await renderServerPage(CourseRosterPage, props);
    const names = () => screen.getAllByRole("link", { name: /Example/ }).map((a) => a.textContent);
    await userEvent.click(screen.getByText("Member"));
    expect(names()).toEqual(["Bramble Example", "Fern Example"]);
    await userEvent.click(screen.getByText("Member"));
    expect(names()).toEqual(["Fern Example", "Bramble Example"]);
  });

  it("says so when nobody has access", async () => {
    loadCourseRoster.mockResolvedValue({ course: { id: "c1", title: "The Ready Writer" }, rows: [] });
    await renderServerPage(CourseRosterPage, props);
    expect(screen.getByText("Nobody has access yet.")).toBeInTheDocument();
  });

  it("is a 404 for a course that isn't in the Hub", async () => {
    loadCourseRoster.mockResolvedValue(null);
    await expect(renderServerPage(CourseRosterPage, props)).rejects.toThrow();
  });
});
