// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
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
import { zoomAttendee } from "@/tests/helpers/zoom-fixtures";
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
  default: ({ prickle, hostMissing, hostLate, hasStarted, insightsSlotUrl, edit }: { prickle: { id: string }; hostMissing: boolean; hostLate: boolean; hasStarted?: boolean; insightsSlotUrl?: string; edit?: { types: { id: string }[]; members: { id: string }[]; overridden: object } }) => (
    <pre data-testid="details">{JSON.stringify({ id: prickle.id, hostMissing, hostLate, hasStarted, insightsSlotUrl, edit: edit && { types: edit.types.map((t) => t.id), members: edit.members.length, overridden: edit.overridden, canSave: typeof edit === "object" } })}</pre>
  ),
}));
vi.mock("@/components/ReturnToTab", () => ({ ReturnToTabLink: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock("@/components/writing/PrickleCheckLinks", () => ({ default: () => <div data-testid="check-links" /> }));
vi.mock("@/app/(member)/my-prickles/AddToCalendar", () => ({
  AddPrickleToCalendar: ({ typeName }: { typeName: string }) => <div data-testid="add-to-calendar">{typeName}</div>,
}));
vi.mock("@/app/(admin)/admin/hygiene/unmatched-zoom/AliasSearchForm", () => ({
  default: ({ unmatchedAttendees, prickleId }: { unmatchedAttendees: { zoomName: string }[]; prickleId?: string }) => (
    <pre data-testid="alias-form">{JSON.stringify({ names: unmatchedAttendees.map((a) => a.zoomName), prickleId })}</pre>
  ),
}));
vi.mock("@/app/(admin)/admin/prickles/[id]/IgnoredZoomNames", () => ({
  default: ({ items }: { items: { zoomName: string; reason: string | null }[] }) => (
    <pre data-testid="ignored-here">{JSON.stringify(items)}</pre>
  ),
}));
vi.mock("@/app/(admin)/admin/prickles/[id]/TestCheckinDMs", () => ({ default: () => <div data-testid="test-dms" /> }));
vi.mock("@/app/(admin)/admin/prickles/[id]/ShowInEvents", () => ({
  default: (props: object) => <div data-testid="show-in-events">{JSON.stringify(props)}</div>,
}));
const features = vi.fn(async (_userId: string): Promise<string[]> => ["events"]);
vi.mock("@/lib/features.server", () => ({ getUserFeaturePreviews: (id: string) => features(id) }));

import MemberPrickleDetailPage, { generateMetadata as memberMetadata } from "@/app/(member)/prickles/[id]/page";
import AdminPrickleDetailPage, { generateMetadata as adminMetadata } from "@/app/(admin)/admin/prickles/[id]/page";

const SPRINT = { id: "prty_AAAAAAAAAAA1", name: "Sprint", normalizedName: "sprint", purpose: "writing", requiresHost: true, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false };
const HOST = { id: "mbr_AAAAAAAAAAA1", name: "Jenn Parker" };
const prickle = (extra: object = {}) => ({
  id: "prkl_AAAAAAAAAAA1", typeId: SPRINT.id, hostId: HOST.id, title: null, source: "calendar", calendarEventId: null,
  startTime: "2097-03-03T15:00:00Z", endTime: "2097-03-03T16:00:00Z", ...extra,
});
const dataset = (prickles: object[], attendance: object[] = [], events: object[] = [], unmatchedEvents: object[] = [], extra: ConstructorParameters<typeof InMemoryDataset>[0] = {}) =>
  createInMemoryRepos(new InMemoryDataset({
    userProfiles: [
      { id: MEMBER_USER.id, email: MEMBER_USER.email!, role: "member" },
      { id: ADMIN_USER.id, email: ADMIN_USER.email!, role: "admin" },
    ],
    members: [HOST], prickleTypes: [SPRINT], prickles: prickles as never, attendance: attendance as never, events: events as never, unmatchedEvents: unmatchedEvents as never, ...extra }));
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

  describe("editing", () => {
    it("makes a calendar prickle editable, with the types, the members and what is already set by hand", async () => {
      const calendarEventId = "00000000-0000-4000-8000-00000000000a";
      const decided = { id: "u1", calendar_event_id: calendarEventId, raw_summary: "Sprint", status: "resolved", created_at: null, resolved_at: null, suggested_host: null, suggested_type: null, resolved_type_id: null, resolved_host_id: null, resolved_title: "Set by hand", resolved_description: null, resolved_guest_speaker: null };
      repos = dataset([prickle({ calendarEventId })], [], [], [decided]);

      await renderServerPage(AdminPrickleDetailPage, memberProps);

      const { edit } = JSON.parse(screen.getByTestId("details").textContent!);
      expect(edit.types).toEqual(["prty_AAAAAAAAAAA1"]);
      expect(edit.overridden).toEqual({ title: true, description: false, guestSpeaker: false, location: false });
    });

    it("leaves a prickle that isn't from the calendar read-only", async () => {
      repos = dataset([prickle()]);

      await renderServerPage(AdminPrickleDetailPage, memberProps);

      expect(JSON.parse(screen.getByTestId("details").textContent!).edit).toBeUndefined();
    });
  });

  describe("the Events control", () => {
    const CALENDAR_ID = "00000000-0000-4000-8000-00000000000a";
    const controlProps = () => JSON.parse(screen.getByTestId("show-in-events").textContent!);

    beforeEach(() => {
      features.mockResolvedValue(["events"]);
      repos = dataset([prickle({ calendarEventId: CALENDAR_ID })]);
    });

    it("offers to show a calendar prickle in Events when it has no event yet", async () => {
      useFakeSupabase({ events: { data: null } });

      await renderServerPage(AdminPrickleDetailPage, memberProps);

      expect(controlProps()).toEqual({ calendarEventId: CALENDAR_ID, initial: null });
    });

    const followingEvent = (deleted_at: string | null) => [{ id: "evt_AAAAAAAAAAA1", slug: "sprint", prickle_id: "prkl_AAAAAAAAAAA1", deleted_at }];

    it("starts from the event that follows the prickle, shown or hidden", async () => {
      repos = dataset([prickle({ calendarEventId: CALENDAR_ID })], [], followingEvent(null));
      await renderServerPage(AdminPrickleDetailPage, memberProps);
      expect(controlProps().initial).toEqual({ id: "evt_AAAAAAAAAAA1", slug: "sprint", hidden: false });
      cleanup();

      repos = dataset([prickle({ calendarEventId: CALENDAR_ID })], [], followingEvent("2097-01-01T00:00:00Z"));
      await renderServerPage(AdminPrickleDetailPage, memberProps);
      expect(controlProps().initial).toEqual({ id: "evt_AAAAAAAAAAA1", slug: "sprint", hidden: true });
    });

    it("leaves the control out for a prickle with no calendar event, and when events aren't enabled", async () => {
      repos = dataset([prickle()]);
      await renderServerPage(AdminPrickleDetailPage, memberProps);
      expect(screen.queryByTestId("show-in-events")).not.toBeInTheDocument();
      cleanup();

      repos = dataset([prickle({ calendarEventId: CALENDAR_ID })]);
      features.mockResolvedValue([]);
      await renderServerPage(AdminPrickleDetailPage, memberProps);
      expect(screen.queryByTestId("show-in-events")).not.toBeInTheDocument();
    });
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

describe("unmatched Zoom names", () => {
  // In the room during the prickle (15:00-16:00)
  const inRoom = (name: string, extra: object = {}) =>
    zoomAttendee({ name, join_time: "2097-03-03T15:05:00Z", leave_time: "2097-03-03T15:50:00Z", ...extra });
  const zoomAttendees = [inRoom("iPhone"), inRoom("Zed Unknown", { meeting_uuid: "m1" }), inRoom("Everywhere Ignored")];
  const withZoom = () => {
    repos = dataset([prickle()], [], [], [], {
      zoomAttendees,
      ignoredZoomNames: [{ id: "ign-1", zoom_name: "Everywhere Ignored", reason: null, ignored_by: null, ignored_at: null, created_at: null }],
      ignoredZoomAppearances: [{ id: "igza-1", prickle_id: "prkl_AAAAAAAAAAA1", zoom_name: "iPhone", reason: "a guest", ignored_by: null, ignored_at: "2097-03-03T00:00:00Z" }],
    });
  };
  const fakeTables = (role: string) => ({
    user_profiles: { data: { role } },
    staff: { data: [] },
  });

  it("member page: an admin sees names not ignored here or everywhere, scoped to this prickle", async () => {
    signInAs(ADMIN_USER, MEMBER_IDENTITY);
    withZoom();
    useFakeSupabase(fakeTables("admin"));

    await renderServerPage(MemberPrickleDetailPage, memberProps);

    expect(JSON.parse(screen.getByTestId("alias-form").textContent!)).toEqual({ names: ["Zed Unknown"], prickleId: "prkl_AAAAAAAAAAA1" });
    expect(JSON.parse(screen.getByTestId("ignored-here").textContent!)).toEqual([{ zoomName: "iPhone", reason: "a guest" }]);
  });

  it("member page: a member never sees the form", async () => {
    useFakeSupabase(fakeTables("member"));

    await renderServerPage(MemberPrickleDetailPage, memberProps);

    expect(screen.queryByTestId("alias-form")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ignored-here")).not.toBeInTheDocument();
  });

  it("admin page: the same two ignores apply", async () => {
    signInAs(ADMIN_USER);
    withZoom();
    useFakeSupabase(fakeTables("admin"));

    await renderServerPage(AdminPrickleDetailPage, memberProps);

    expect(JSON.parse(screen.getByTestId("alias-form").textContent!)).toEqual({ names: ["Zed Unknown"], prickleId: "prkl_AAAAAAAAAAA1" });
    expect(JSON.parse(screen.getByTestId("ignored-here").textContent!)).toEqual([{ zoomName: "iPhone", reason: "a guest" }]);
  });
});
