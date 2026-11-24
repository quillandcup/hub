// @vitest-environment jsdom
// Each table that adopted TableKeyboardNav: j moves to the first row and Enter opens the row's main link or action
// (not the first link in the row), and where a page holds several tables, Tab reaches the one you mean.
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: nav.refresh }),
  usePathname: () => "/admin/test",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _prefetch, ...props }: { href: string; children: ReactNode; prefetch?: boolean }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/RecordHistoryButton", () => ({ default: () => null }));
vi.mock("@/app/(admin)/admin/courses/[id]/comments/ModerationButtons", () => ({ default: () => null }));
const track = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/client", () => ({ track }));
const markRead = vi.hoisted(() => vi.fn());
vi.mock("@/components/InAppNotifications", () => ({
  useInAppNotifications: () => ({ error: null, markRead, markUnread: vi.fn(), markAllRead: vi.fn() }),
}));
vi.mock("@/app/(admin)/admin/hygiene/zoom-meetings/actions", () => ({ decideZoomMeetings: vi.fn() }));

import ActivityFeedTable from "@/app/(admin)/admin/activity/ActivityFeedTable";
import OffersTable from "@/app/(admin)/admin/offers/OffersTable";
import UsersClient from "@/app/(admin)/admin/users/UsersClient";
import HostsClient from "@/app/(admin)/admin/hosts/HostsClient";
import MatchesPanel from "@/app/(admin)/admin/mentorship/MatchesPanel";
import WorkQueueSections from "@/app/(admin)/admin/work-queue/WorkQueueSections";
import PrickleTypesTable from "@/app/(admin)/admin/data/prickle-types/PrickleTypesTable";
import ReconciliationClient from "@/app/(admin)/admin/reconciliation/ReconciliationClient";
import { ReportedTable, HeldTable } from "@/app/(admin)/admin/courses/[id]/comments/ModerationTables";
import UnansweredTable from "@/app/(admin)/admin/courses/[id]/comments/UnansweredTable";
import NotificationInbox from "@/app/(member)/notifications/NotificationInbox";
import PrickleDetails from "@/components/PrickleDetails";
import GroupedTable from "@/app/(admin)/admin/insights/prickles/[kind]/GroupedTable";
import ZoomMeetingsReview, { type ReviewRow } from "@/app/(admin)/admin/hygiene/zoom-meetings/ZoomMeetingsReview";
import MemberSlackActivityPanel from "@/app/(admin)/admin/members/[id]/MemberSlackActivityPanel";
import { MEMBER_DEFAULTS, type ActivityFeedRow } from "@/lib/activity-feed";
import type { MentorshipRow } from "@/lib/mentorship";
import type { WorkQueueItem } from "@/lib/admin-work-queue";
import type { PrickleDetail } from "@/lib/domain/prickle";
import type { GroupStats } from "@/lib/scheduled-prickle-stats";
import type { InAppNotification } from "@/lib/channels/in-app";

const MBR_A = "mbr_AAAAAAAAAAA1";
const MBR_B = "mbr_AAAAAAAAAAA2";

/** Records what a keypress clicks, and stops the browser from following it. */
function recordClicks() {
  const clicked: Element[] = [];
  const onClick = (event: Event) => {
    // Only a link is stopped; a checkbox must still toggle.
    if ((event.target as Element).closest("a")) event.preventDefault();
    clicked.push(event.target as Element);
  };
  document.addEventListener("click", onClick, true);
  return {
    clicked,
    hrefs: () => clicked.map((el) => el.closest("a")?.getAttribute("href") ?? null),
    stop: () => document.removeEventListener("click", onClick, true),
  };
}

let recorder: ReturnType<typeof recordClicks>;

beforeEach(() => {
  recorder = recordClicks();
  nav.push.mockClear();
  markRead.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  recorder.stop();
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const region = (name: string, index = 0) => screen.getAllByRole("group", { name })[index];
const activeRows = () => [...document.querySelectorAll('tr[data-kbd-active="true"]')] as HTMLElement[];

/** Tab to the table's region, move to the first row and press Enter. */
async function openFirstRow(name: string, index = 0) {
  const user = userEvent.setup();
  region(name, index).focus();
  await user.keyboard("j{Enter}");
  return user;
}

describe("tables whose first link is not the main one", () => {
  it("ActivityFeedTable opens the row's source, or the member when it has none, never the actor filter", async () => {
    const row = (over: Partial<ActivityFeedRow>): ActivityFeedRow => ({
      event_id: "e1",
      kind: "activity",
      occurred_at: "2097-01-01T10:00:00Z",
      is_audit: false,
      actor_user_id: "usr_1",
      actor_kind: "staff",
      actor_label: "Fern Staff",
      member_id: MBR_A,
      member_name: "Ada Example",
      acting_as_member_id: null,
      acting_as_member_name: null,
      event_type: "note",
      entity_type: null,
      entity_id: null,
      title: "Did a thing",
      description: null,
      source: "app",
      data: {},
      ...over,
    });
    render(
      <ActivityFeedTable
        rows={[row({ event_id: "e1", entity_type: "prickle", entity_id: "prkl_AAAAAAAAAAA1" }), row({ event_id: "e2" })]}
        total={2}
        page={1}
        pageSize={50}
        filters={MEMBER_DEFAULTS as never}
      />,
    );
    const user = await openFirstRow("Activity log");
    expect(recorder.hrefs()).toEqual(["/admin/prickles/prkl_AAAAAAAAAAA1"]);
    await user.keyboard("j{Enter}");
    expect(recorder.hrefs().at(-1)).toBe(`/admin/members/${MBR_A}`);
  });

  it("OffersTable opens the Hub resource, and opens its Kajabi page only when an offer has none", async () => {
    const offer = (offerId: string, resources: { kind: "event"; title: string; href: string }[]) => ({
      offerId,
      name: `Offer ${offerId}`,
      status: null,
      kajabiUrl: `https://kajabi.example.test/${offerId}`,
      checkoutUrl: null,
      resources,
    });
    render(
      <OffersTable
        rows={[offer("a", [{ kind: "event", title: "Spring retreat", href: "/admin/events/spring" }]), offer("b", [])]}
      />,
    );
    // The default sort puts the offer with no resource first: its only link is the Kajabi page.
    const user = await openFirstRow("Offers");
    expect(recorder.hrefs()).toEqual(["https://kajabi.example.test/b"]);
    await user.keyboard("j{Enter}");
    expect(recorder.hrefs().at(-1)).toBe("/admin/events/spring");
  });

  it("UsersClient opens the linked member", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              users: [
                {
                  id: "u1",
                  email: "ada@example.test",
                  role: "member",
                  features: [],
                  createdAt: "2026-01-01T00:00:00Z",
                  staffId: null,
                  staffName: null,
                  staffRole: null,
                  memberId: MBR_A,
                  memberName: "Ada Example",
                  memberDisplayName: null,
                  aliases: [],
                  pending: false,
                  bannedUntil: null,
                },
              ],
              allMembers: [],
            }),
        } as Response),
      ),
    );
    render(<UsersClient currentUserId="me" />);
    await screen.findByText("All Users (1)");
    await openFirstRow("Users");
    expect(recorder.hrefs()).toEqual([`/admin/members/${MBR_A}`]);
  });

  it("HostsClient opens the host's member page", async () => {
    const month = new Date().toISOString().slice(0, 7) + "-01";
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) => {
        const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body });
        if (String(input).startsWith("/api/prickle-schedules?month=")) {
          return json({
            schedules: [
              {
                id: "s1",
                host_id: "m1",
                type_id: "t1",
                month,
                recurrence_type: "weekly",
                day_of_week: 1,
                recurrence_anchor_date: null,
                week_of_month: null,
                event_date: null,
                start_time_local: "10:00",
                timezone: "America/New_York",
                status: "confirmed",
                notes: null,
                carried_forward_from: null,
                member: { id: "m1", name: "Juniper Quill", email: "j@example.test" },
                prickle_type: { id: "t1", name: "Progress Prickle" },
                host_eligibility: { eligible: true },
              },
            ],
          });
        }
        if (String(input) === "/api/prickle-schedule-locks") return json({ locks: [] });
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      }),
    );
    render(<HostsClient prickleTypes={[{ id: "t1", name: "Progress Prickle" }]} />);
    await screen.findByText("Juniper Quill");
    await openFirstRow("Host schedules");
    expect(recorder.hrefs()).toEqual(["/admin/members/m1"]);
  });

  it("MatchesPanel opens the new member, not the big sister", async () => {
    const match: MentorshipRow = {
      id: "x",
      mentorMemberId: MBR_A,
      mentorName: "Ada Quill",
      newMemberId: MBR_B,
      newMemberName: "Bea Moss",
      startedOn: "2026-03-01",
      trialEndsOn: "2026-03-08",
      kind: "trial",
      status: "matched",
      active: false,
      outcomeNote: null,
      outcome: "converted",
      convertedOn: "2026-03-20",
      currentMember: true,
    };
    render(<MatchesPanel rows={[match]} openLoad={{}} />);
    await openFirstRow("Matches");
    expect(recorder.hrefs()).toEqual([`/admin/members/${MBR_B}`]);
  });

  it("PrickleTypesTable opens the type's edit page", async () => {
    render(
      <PrickleTypesTable
        rows={[
          {
            id: "prty_AAAAAAAAAAA1",
            name: "Educational Prickle",
            normalized_name: "educational",
            description: null,
            purpose: "work",
            solo_task_friendly: false,
            listed_in_events: true,
            announced_publicly: false,
            guests_allowed: false,
          },
        ]}
      />,
    );
    await openFirstRow("Prickle types");
    expect(recorder.hrefs()).toEqual(["/admin/data/prickle-types/prty_AAAAAAAAAAA1/edit"]);
  });
});

describe("work queue: one table per section on the same page", () => {
  const item = (queueType: WorkQueueItem["queueType"], memberId: string, memberName: string): WorkQueueItem => ({
    queueType,
    memberId,
    memberName,
    occurrenceKey: `${memberId}-k`,
    deadline: "2026-11-20",
    label: "Event",
  });
  const renderQueue = (props: Partial<React.ComponentProps<typeof WorkQueueSections>> = {}) =>
    render(
      <WorkQueueSections
        welcomeBackQueue={[item("welcome_back", MBR_A, "Ada Example")]}
        hedgieversaryQueue={[item("hedgieversary", MBR_B, "Bea Example")]}
        hiatusNudgeQueue={[]}
        bigSisterQueue={[]}
        {...props}
      />,
    );

  it("j does nothing until a table has focus, because the page has two", async () => {
    renderQueue();
    const user = userEvent.setup();
    await user.keyboard("j");
    expect(activeRows()).toEqual([]);
  });

  it("the keys act on the focused table only", async () => {
    renderQueue();
    const user = userEvent.setup();
    const first = region("Welcome Back");
    const second = region("Hedgieversary Celebrations");
    second.focus();
    await user.keyboard("j");
    expect(within(second).getAllByRole("row").filter((r) => r.getAttribute("data-kbd-active") === "true")).toHaveLength(1);
    expect(within(first).queryAllByRole("row").filter((r) => r.getAttribute("data-kbd-active") === "true")).toHaveLength(0);
    await user.keyboard("{Enter}");
    expect(recorder.hrefs()).toEqual([`/admin/members/${MBR_B}`]);
  });

  it("opens the member rather than the Match link in the row", async () => {
    renderQueue({ welcomeBackQueue: [], hedgieversaryQueue: [], bigSisterQueue: [item("big_sister", MBR_A, "Ada Example")] });
    const user = userEvent.setup();
    // With one table on the page j starts at its first row without focusing it first.
    await user.keyboard("j{Enter}");
    expect(recorder.hrefs()).toEqual([`/admin/members/${MBR_A}`]);
  });
});

describe("reconciliation: several tables on one page", () => {
  it("wraps the member, granted and inactive-attendee tables, and Tab-focus picks the one the keys act on", async () => {
    const person = (id: string) => ({ member_name: `Person ${id}`, member_display_name: null });
    const rec = (id: string) => ({
      member_id: id,
      member_email: `${id}@example.test`,
      expected_kajabi_state: "active",
      actual_kajabi_state: "inactive",
      stripe_state: "none",
      override_id: null,
      override_type: null,
      override_reason: null,
      override_notes: null,
      override_starts_at: null,
      override_expires_at: null,
      is_on_hiatus: false,
      has_discrepancy: true,
      ...person(id),
    });
    const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/analyze/subscription-reconciliation") {
          return ok({
            summary: { total_members: 1, active_in_stripe: 0, paused_in_stripe: 0, active_in_kajabi: 0, total_overrides: 0, discrepancies: 1 },
            members: [rec("m1")],
            metadata: { kajabi_import_timestamp: null, stripe_import_timestamp: null },
          });
        }
        if (url === "/api/analyze/kajabi-grants") {
          return ok({
            grants: [{ kajabi_purchase_id: "g1", offer_name: "O", amount_in_cents: 0, created_at: null, member_id: "g-member", member_email: "g@example.test", member_status: "active", ...person("g") }],
          });
        }
        if (url === "/api/analyze/zoom-access") {
          return ok({ matched_inactive: [{ member_id: "z-member", member_status: "cancelled", prickle_count: 1, ...person("z") }] });
        }
        if (url === "/api/analyze/stripe-orphans") return ok({ total_active_subscriptions: 0, orphans: [] });
        return ok({ total_in_slack: 0, members_in_slack: [] });
      }),
    );
    render(<ReconciliationClient />);
    await screen.findByText("Person z");
    const user = userEvent.setup();

    // Three tables with rows: j with nothing focused starts nowhere.
    await user.keyboard("j");
    expect(activeRows()).toEqual([]);

    region("Members").focus();
    await user.keyboard("j{Enter}");
    expect(recorder.hrefs()).toEqual(["/admin/members/m1"]);
    region("Granted memberships").focus();
    await user.keyboard("j{Enter}");
    expect(recorder.hrefs().at(-1)).toBe("/admin/members/g-member");
    region("Inactive members attending prickles").focus();
    await user.keyboard("j{Enter}");
    expect(recorder.hrefs().at(-1)).toBe("/admin/members/z-member");
    // One highlighted row in each table, none shared.
    expect(activeRows()).toHaveLength(3);
  });
});

describe("course comments tables", () => {
  const reported = {
    commentId: "c1",
    lessonId: "l1",
    lessonTitle: "Lesson one",
    authorName: "Ada Example",
    body: "Reported words",
    isReply: false,
    state: "visible" as const,
    reportCount: 2,
    reasons: ["spam"],
    firstReportedAt: "2026-11-01T10:00:00Z",
  };
  const held = { id: "c2", lessonId: "l2", lessonTitle: "Lesson two", authorName: "Bea Example", body: "Held words", isReply: false, createdAt: "2026-11-01T10:00:00Z" };
  const now = Date.parse("2026-11-02T10:00:00Z");

  it("the reported and held tables on one page are separate stops, and Enter opens each one's comment", async () => {
    render(
      <>
        <ReportedTable rows={[reported]} courseId="crs_1" courseSlug="craft" nowMs={now} />
        <HeldTable rows={[held]} courseId="crs_1" courseSlug="craft" nowMs={now} />
      </>,
    );
    const user = userEvent.setup();
    await user.keyboard("j");
    expect(activeRows()).toEqual([]);
    await openFirstRow("Reported comments");
    expect(recorder.hrefs()).toEqual(["/courses/craft/lessons/l1?comment=c1"]);
    await openFirstRow("Held comments");
    expect(recorder.hrefs().at(-1)).toBe("/courses/craft/lessons/l2?comment=c2");
  });

  it("UnansweredTable opens the lesson thread", async () => {
    render(
      <UnansweredTable
        rows={[{ id: "q1", lessonId: "l3", lessonTitle: "Lesson three", authorName: "Cleo Example", createdAt: "2026-11-01T10:00:00Z", body: "A question" }]}
        courseId="crs_1"
        courseSlug="craft"
        nowMs={now}
      />,
    );
    await openFirstRow("Unanswered questions");
    expect(recorder.hrefs()).toEqual(["/courses/craft/lessons/l3?comment=q1"]);
  });
});

describe("other adopted tables", () => {
  it("NotificationInbox opens the notification's link and marks it read, as a click does", async () => {
    const n: InAppNotification = { id: "n1", kind: "prickle_checkin", text: "First", url: "/prickles/p1", createdAt: "2026-10-05T10:00:00Z", read: false, banner: false };
    render(<NotificationInbox inbox={{ items: [n], total: 1, counts: { all: 1, unread: 1 }, page: 1, pageSize: 25 }} filter="all" kind={null} />);
    await openFirstRow("Notifications");
    expect(recorder.hrefs()).toEqual(["/prickles/p1"]);
    expect(markRead).toHaveBeenCalledWith(["n1"]);
  });

  it("PrickleDetails opens the attendee's page", async () => {
    const prickle: PrickleDetail = {
      id: "p1",
      typeId: "t1",
      hostId: "h1",
      title: null,
      description: null,
      startTime: "2026-10-20T15:00:00Z",
      endTime: "2026-10-20T16:00:00Z",
      source: "calendar",
      calendarEventId: null,
      host: { id: "h1", name: "Jenn Parker", displayName: null },
      type: { id: "t1", name: "Progress Prickle", normalizedName: "progress", description: null, purpose: "writing", requiresHost: true, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false },
    };
    render(
      <PrickleDetails
        prickle={prickle}
        attendanceRecords={[{ id: "a1", member_id: "m1", join_time: "2026-10-20T15:02:00Z", leave_time: "2026-10-20T16:00:00Z", members: { id: "m1", name: "Fern Quillsby" } }]}
        hostMissing={false}
        hostLate={false}
        hasStarted
        userTimezonePreference="America/New_York"
        memberBasePath="/members"
        showMemberEmails={false}
      />,
    );
    await openFirstRow("Attendees");
    expect(recorder.hrefs()).toEqual(["/members/m1"]);
  });

  it("GroupedTable's Enter expands the group, the open detail is not a row, and j moves to the next group", async () => {
    const group = (i: number): GroupStats => ({
      groupKey: `slot-${i}`,
      groupLabel: `Slot ${i}`,
      sessions: 1,
      min: 1,
      median: 2,
      mean: 2,
      max: 3,
      sparkline: [],
      lastSession: "2026-09-01T10:00:00Z",
      prickleSessions: [{ id: `p-${i}`, startTime: "2026-09-01T10:00:00Z", attendeeCount: 2, attendeeNames: ["Fern", "Wren"], hostName: null }],
    });
    Element.prototype.scrollIntoView = vi.fn();
    render(<GroupedTable rows={[group(1), group(2)]} groupBy="schedule" />);
    const user = await openFirstRow("Schedule slots");
    expect(screen.getByText(/1 session — most recent first/)).toBeInTheDocument();
    await user.keyboard("j");
    expect(activeRows()[0]).toHaveTextContent("Slot 2");
    await user.keyboard("{Enter}");
    expect(screen.getAllByText(/1 session — most recent first/)).toHaveLength(2);
  });

  it("ZoomMeetingsReview moves with j and Space selects the highlighted meeting", async () => {
    const meeting = (n: number): ReviewRow => ({
      zoomAccount: "zacc_SecondAcct01",
      accountLabel: "Second account",
      meetingUuid: `uuid-${n}`,
      meetingId: `mid-${n}`,
      topic: `Meeting ${n}`,
      startTime: `2026-10-0${n}T15:00:00Z`,
      participantCount: n,
      state: "undecided",
    });
    render(<ZoomMeetingsReview rows={[meeting(1), meeting(2)]} accounts={[{ id: "zacc_SecondAcct01", label: "Second account" }]} timeZone="America/New_York" />);
    const user = userEvent.setup();
    region("Zoom meetings").focus();
    await user.keyboard("j");
    await user.keyboard(" ");
    expect(within(activeRows()[0]).getByRole("checkbox")).toBeChecked();
    expect(screen.getAllByRole("checkbox").filter((box) => (box as HTMLInputElement).checked)).toHaveLength(1);
  });

  it("MemberSlackActivityPanel opens a message in Slack, and does nothing for a row with no permalink", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const activity = (id: string, data: Record<string, unknown>) => ({
      id,
      activity_type: "slack_message",
      occurred_at: "2026-09-01T10:00:00Z",
      description: `message ${id}`,
      data,
    });
    render(
      <MemberSlackActivityPanel
        slackPage={{
          rows: [activity("1", { channel_name: "writing" }), activity("2", { channel_name: "writing", channel_id: "C123", message_ts: "1700000000.000100" })],
          total: 2,
          page: 1,
          pageSize: 50,
          kind: "all",
          channel: null,
          channels: [{ name: "writing", count: 2 }],
        }}
        slackSummary={{ total: 2, messages: 2, reactions: 0, channels: 1, last30Days: 2 }}
      />,
    );
    const user = await openFirstRow("Recent Slack activity");
    expect(open).not.toHaveBeenCalled();
    await user.keyboard("j{Enter}");
    expect(open).toHaveBeenCalledTimes(1);
    expect(String(open.mock.calls[0][0])).toContain("1700000000000100");
    expect(open.mock.calls[0][1]).toBe("_blank");
  });
});
