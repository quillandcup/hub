// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import {
  ADMIN_USER,
  MEMBER_IDENTITY,
  MEMBER_USER,
  renderServerPage,
  resetServerPageMocks,
  signInAs,
  useFakeSupabase,
} from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: vi.fn(async () => undefined) }));
vi.mock("@/lib/timezone", () => ({ getUserTimezonePreference: vi.fn(async () => "America/New_York") }));
vi.mock("@/app/(member)/my-prickles/calendar-feed-actions", () => ({ getMyCalendarItems: vi.fn(async () => []) }));
vi.mock("@/app/(member)/projects/actions", () => ({ getMyEntriesForPrickle: vi.fn(async () => []) }));
vi.mock("@/app/(member)/prickles/checkin-actions", () => ({ getMyCheckin: vi.fn(async () => null) }));
vi.mock("@/lib/prickle-roster", () => ({ loadPrickleRoster: vi.fn(async () => null) }));
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
// The children show what the pages hand them.
vi.mock("@/components/PrickleDetails", () => ({
  default: ({ prickle, hostMissing, hostLate, hasStarted, insightsSlotUrl }: { prickle: { id: string }; hostMissing: boolean; hostLate: boolean; hasStarted?: boolean; insightsSlotUrl?: string }) => (
    <pre data-testid="details">{JSON.stringify({ id: prickle.id, hostMissing, hostLate, hasStarted, insightsSlotUrl })}</pre>
  ),
}));
vi.mock("@/components/ReturnToTab", () => ({ ReturnToTabLink: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock("@/components/writing/PrickleCheckLinks", () => ({ default: () => <div data-testid="check-links" /> }));
vi.mock("@/app/(member)/my-prickles/AddToCalendar", () => ({
  AddPrickleToCalendar: ({ typeName }: { typeName: string }) => <div data-testid="add-to-calendar">{typeName}</div>,
}));
vi.mock("@/app/(admin)/admin/hygiene/unmatched-zoom/AliasSearchForm", () => ({ default: () => null }));
vi.mock("@/app/(admin)/admin/prickles/[id]/TestCheckinDMs", () => ({ default: () => <div data-testid="test-dms" /> }));

import MemberPrickleDetailPage, { generateMetadata as memberMetadata } from "@/app/(member)/prickles/[id]/page";
import AdminPrickleDetailPage, { generateMetadata as adminMetadata } from "@/app/(admin)/admin/prickles/[id]/page";

const SPRINT = { id: "prty_AAAAAAAAAAA1", name: "Sprint", normalizedName: "sprint", purpose: "writing", requiresHost: true, soloTaskFriendly: false, isSpecialty: false };
const HOST = { id: "mbr_AAAAAAAAAAA1", name: "Jenn Parker" };
const prickle = (extra: object = {}) => ({
  id: "prkl_AAAAAAAAAAA1", typeId: SPRINT.id, hostId: HOST.id, title: null, source: "calendar", calendarEventId: null,
  startTime: "2097-03-03T15:00:00Z", endTime: "2097-03-03T16:00:00Z", ...extra,
});
const dataset = (prickles: object[], attendance: object[] = []) =>
  createInMemoryRepos(new InMemoryDataset({ members: [HOST], prickleTypes: [SPRINT], prickles: prickles as never, attendance: attendance as never }));
const memberProps = { params: Promise.resolve({ id: "prkl_AAAAAAAAAAA1" }) };

beforeEach(() => {
  resetServerPageMocks();
  signInAs(MEMBER_USER, MEMBER_IDENTITY);
  useFakeSupabase({ user_profiles: { data: { role: "member" } } });
  repos = dataset([prickle()]);
});

describe("member prickle page", () => {
  it("shows the prickle, and offers to add an upcoming one to the calendar", async () => {
    await renderServerPage(MemberPrickleDetailPage, memberProps);

    expect(JSON.parse(screen.getByTestId("details").textContent!)).toMatchObject({ id: "prkl_AAAAAAAAAAA1", hasStarted: false, hostMissing: false });
    expect(screen.getByTestId("add-to-calendar")).toHaveTextContent("Sprint");
  });

  it("says when the prickle isn't there", async () => {
    repos = dataset([]);

    await renderServerPage(MemberPrickleDetailPage, memberProps);

    expect(screen.getByRole("heading", { name: "Prickle not found" })).toBeInTheDocument();
  });

  it("flags a host who never came to a prickle that is over", async () => {
    repos = dataset([prickle({ startTime: "2020-03-03T15:00:00Z", endTime: "2020-03-03T16:00:00Z" })]);

    await renderServerPage(MemberPrickleDetailPage, memberProps);

    expect(JSON.parse(screen.getByTestId("details").textContent!)).toMatchObject({ hasStarted: true, hostMissing: true, hostLate: false });
    expect(screen.queryByTestId("add-to-calendar")).not.toBeInTheDocument(); // it's over
  });

  it("titles the page for the type and host, or with a title the host gave it", async () => {
    expect(await memberMetadata(memberProps)).toEqual({ title: "Sunday Sprint with Jenn P" });
    repos = dataset([prickle({ title: "Tiny Things Workshop" })]);
    expect(await memberMetadata(memberProps)).toEqual({ title: "Tiny Things Workshop" });
    repos = dataset([]);
    expect(await memberMetadata(memberProps)).toEqual({ title: "Prickle" });
  });
});

describe("admin prickle page", () => {
  beforeEach(() => {
    signInAs(ADMIN_USER);
  });

  it("shows the prickle with its host punctuality and the test-DM tools", async () => {
    repos = dataset(
      [prickle({ startTime: "2020-03-03T15:00:00Z", endTime: "2020-03-03T16:00:00Z" })],
      [{ id: "att_1", memberId: HOST.id, prickleId: "prkl_AAAAAAAAAAA1", joinTime: "2020-03-03T15:30:00Z", leaveTime: "2020-03-03T16:00:00Z" }],
    );

    await renderServerPage(AdminPrickleDetailPage, memberProps);

    expect(JSON.parse(screen.getByTestId("details").textContent!)).toMatchObject({ id: "prkl_AAAAAAAAAAA1", hostLate: true, hostMissing: false });
    expect(screen.getByTestId("test-dms")).toBeInTheDocument();
  });

  it("links to the type's insights for this weekday and time", async () => {
    await renderServerPage(AdminPrickleDetailPage, memberProps);

    const { insightsSlotUrl } = JSON.parse(screen.getByTestId("details").textContent!);
    expect(insightsSlotUrl).toMatch(/^\/admin\/insights\/prickles\/sprint\?group=schedule&slot=/);
  });

  it("titles the page, and falls back when there is no such prickle", async () => {
    expect(await adminMetadata(memberProps)).toEqual({ title: "Sunday Sprint with Jenn P" });
    repos = dataset([]);
    expect(await adminMetadata(memberProps)).toEqual({ title: "Prickle" });
  });
});
