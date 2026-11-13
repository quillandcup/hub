// @vitest-environment jsdom
/** The course's Customers tab (the old "who's where" roster) and its sortable table. The loader is mocked; markup is real. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ADMIN_USER, MEMBER_USER, expectRedirect, renderServerPage, resetServerPageMocks, signInAs, ROLE_PROFILES } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));

// Roles come from the profile repository, in memory here.
let dataset = new InMemoryDataset();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => createInMemoryRepos(dataset),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));

const loadCourseRoster = vi.fn();
vi.mock("@/lib/courses/roster-data", () => ({ loadCourseRoster: (...a: unknown[]) => loadCourseRoster(...a) }));

vi.mock("@/app/(admin)/admin/courses/[id]/CourseAdminPage", () => ({
  default: (props: { idParam: string; tab: string }) => <div data-testid="shell" data-id={props.idParam} data-tab={props.tab} />,
  courseTabMetadata: async () => ({ title: "x" }),
}));

import CourseRosterPage from "@/app/(admin)/admin/courses/[id]/roster/page";
import { customersPanel } from "@/app/(admin)/admin/courses/[id]/customers-panel";

/** Renders the Customers tab's content. */
async function renderPanel() {
  const panel = await customersPanel("kaj-1");
  return render(<>{panel!.content}</>);
}

const row = (id: string, name: string, over: object = {}) => ({
  memberId: id, name, startsAt: "2026-01-01T00:00:00Z", endsAt: null, origin: "purchase", accessActive: true,
  completed: 1, total: 4, lastLessonId: "l1", lastLessonTitle: "Reader Expectations", lastActivityAt: "2026-10-05T10:00:00Z", ...over,
});
const props = { params: Promise.resolve({ id: "kaj-1" }) };

beforeEach(() => {
  resetServerPageMocks();
  dataset = new InMemoryDataset({ userProfiles: ROLE_PROFILES });
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
  it("is the Customers tab of the course shell, at the old address", async () => {
    await renderServerPage(CourseRosterPage, props);
    expect(screen.getByTestId("shell")).toHaveAttribute("data-tab", "roster");
    expect(screen.getByTestId("shell")).toHaveAttribute("data-id", "kaj-1");
  });

  it("counts the customers in the tab label", async () => {
    expect((await customersPanel("kaj-1"))!.label).toBe("Customers (2)");
  });

  it("shows the legal name under a display name", async () => {
    loadCourseRoster.mockResolvedValue({ course: { id: "c1", title: "Course" }, rows: [row("mbr_AAAAAAAAAAA1", "Ada E", { realName: "Ada Example" })] });
    await renderPanel();
    expect(screen.getByRole("link", { name: "Ada E" })).toBeInTheDocument();
    expect(screen.getByText("Ada Example")).toBeInTheDocument();
  });

  it("sends a member to /no-access", async () => {
    signInAs(MEMBER_USER, null);
    await expectRedirect(CourseRosterPage, props, "/no-access");
  });

  it("lists members with progress, last lesson and access", async () => {
    await renderPanel();
    const fern = screen.getByRole("link", { name: "Fern Example" }).closest("tr")!;
    expect(screen.getByRole("link", { name: "Fern Example" })).toHaveAttribute("href", "/admin/members/mbr_AAAAAAAAAAA1");
    expect(within(fern).getByText("4 of 4")).toBeInTheDocument();
    expect(within(fern).getByText("Reader Expectations")).toBeInTheDocument();
    const bramble = screen.getByRole("link", { name: "Bramble Example" }).closest("tr")!;
    expect(within(bramble).getByText("Not started")).toBeInTheDocument();
    expect(within(bramble).getByText(/Ended/)).toBeInTheDocument();
  });

  it("sorts by member name when the header is clicked", async () => {
    await renderPanel();
    const names = () => screen.getAllByRole("link", { name: /Example/ }).map((a) => a.textContent);
    await userEvent.click(screen.getByText("Member"));
    expect(names()).toEqual(["Bramble Example", "Fern Example"]);
    await userEvent.click(screen.getByText("Member"));
    expect(names()).toEqual(["Fern Example", "Bramble Example"]);
  });

  it("says so when nobody has access", async () => {
    loadCourseRoster.mockResolvedValue({ course: { id: "c1", title: "The Ready Writer" }, rows: [] });
    await renderPanel();
    expect(screen.getByText("Nobody has access yet.")).toBeInTheDocument();
  });

  it("has no Customers tab for a course that isn't in the Hub", async () => {
    loadCourseRoster.mockResolvedValue(null);
    expect(await customersPanel("kaj-1")).toBeNull();
  });
});
