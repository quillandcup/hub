// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ADMIN_USER, expectRedirect, renderServerPage, resetServerPageMocks, signInAs } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
const adminPage = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/lib/admin-auth", async () => {
  const { redirect } = await import("@/tests/helpers/server-page");
  return {
    requireAdminPage: vi.fn(async () => {
      if (!adminPage.allowed) redirect("/no-access");
    }),
  };
});
vi.mock("@/lib/timezone", () => ({ getViewerTimeZone: async () => "America/New_York" }));
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/app/(admin)/admin/hygiene/zoom-meetings/actions", () => ({ decideZoomMeetings: vi.fn() }));

import ZoomMeetingsPage from "@/app/(admin)/admin/hygiene/zoom-meetings/page";

beforeEach(() => {
  resetServerPageMocks();
  signInAs(ADMIN_USER);
  adminPage.allowed = true;
  repos = createInMemoryRepos(new InMemoryDataset());
});

describe("Zoom meetings review page", () => {
  it("is for admins only", async () => {
    adminPage.allowed = false;

    await expectRedirect(ZoomMeetingsPage, {}, "/no-access");
  });

  it("says there is nothing to review when every account keeps its meetings", async () => {
    await renderServerPage(ZoomMeetingsPage, {});

    expect(screen.getByRole("heading", { name: "Zoom Meetings" })).toBeInTheDocument();
    expect(screen.getByText(/nothing to review/)).toBeInTheDocument();
  });

  it("lists the meetings of an excluded account, with the account's label and none of the primary account's", async () => {
    const second = await repos.zoom.createAccount({ slug: "secondary", label: "Staff personal account", hostEmail: null, defaultPolicy: "exclude", credentialsPrefix: "ZOOM_SECONDARY" });
    const base = { meeting_id: "111", end_time: null, data: {} };
    await repos.zoom.upsertMeeting({ ...base, zoom_account: second.id, meeting_uuid: "uuid-1", topic: "Dentist call", start_time: "2026-10-01T15:00:00Z" });
    await repos.zoom.upsertMeeting({ ...base, meeting_uuid: "uuid-2", topic: "Morning Writing", start_time: "2026-10-01T13:00:00Z" });

    await renderServerPage(ZoomMeetingsPage, {});

    expect(screen.getByText(/Accounts reviewed here: Staff personal account/)).toBeInTheDocument();
    expect(screen.getAllByText("Staff personal account").length).toBeGreaterThan(0);
    expect(screen.getByText("Dentist call")).toBeInTheDocument();
    expect(screen.queryByText("Morning Writing")).not.toBeInTheDocument();
  });
});
