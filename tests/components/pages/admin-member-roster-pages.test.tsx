// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ADMIN_USER, renderServerPage, resetServerPageMocks, signInAs, useFakeSupabase } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { zoomAttendee } from "@/tests/helpers/zoom-fixtures";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: vi.fn(async () => undefined) }));
// Members come from their repository, in memory here.
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
// Client components show what the pages hand them.
vi.mock("@/app/(admin)/admin/segments/SegmentsClient", () => ({
  default: ({ allMembers }: { allMembers: unknown[] }) => <pre data-testid="segments">{JSON.stringify(allMembers)}</pre>,
}));
vi.mock("@/app/(admin)/admin/hygiene/ambiguous-names/AmbiguousNamesResolver", () => ({
  default: ({ entries }: { entries: unknown[] }) => <pre data-testid="entries">{JSON.stringify(entries)}</pre>,
}));

vi.mock("@/app/(admin)/admin/hygiene/merge-fix/MergeFixClient", () => ({
  default: ({ duplicateGroups }: { duplicateGroups: { members: Record<string, unknown>[] }[] }) => (
    <pre data-testid="groups">{JSON.stringify(duplicateGroups.map((g) => g.members.map((m) => ({ id: m.id, stripe: m.stripe_customer_id, active: m.stripe_active }))))}</pre>
  ),
}));

import SegmentsPage from "@/app/(admin)/admin/segments/page";
import MergeFixPage from "@/app/(admin)/admin/hygiene/merge-fix/page";
import MissingMemberDataPage from "@/app/(admin)/admin/hygiene/missing-member-data/page";
import AmbiguousNamesPage from "@/app/(admin)/admin/hygiene/ambiguous-names/page";

const ADA = { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.test", userId: "user-secret", staffRole: "admin" };
const FERN = { id: "mbr_AAAAAAAAAAA2", name: "Fern Example", email: "fern@example.test", displayName: "Penny" };
const BEA = { id: "mbr_AAAAAAAAAAA3", name: "Bea Example", email: "bea@example.test" };

beforeEach(() => {
  resetServerPageMocks();
  signInAs(ADMIN_USER);
  repos = createInMemoryRepos(new InMemoryDataset({ members: [ADA, FERN, BEA] }));
});

describe("segments page", () => {
  it("hands the picker every member by name and display name, with only the fields it shows", async () => {
    useFakeSupabase({});

    await renderServerPage(SegmentsPage, {});

    const shown = JSON.parse(screen.getByTestId("segments").textContent!);
    expect(shown.map((m: { name: string }) => m.name)).toEqual(["Ada Example", "Bea Example", "Fern Example"]);
    expect(shown[0]).toEqual({ id: ADA.id, name: ADA.name, displayName: null, email: ADA.email }); // no auth user id or role
  });
});

describe("ambiguous Zoom names page", () => {
  const SAM_ADA = { id: "mbr_AAAAAAAAAAB4", name: "Sam Ada", email: "samada@example.test" };
  const SAM_FERN = { id: "mbr_AAAAAAAAAAB5", name: "Sam Fern", email: "samfern@example.test" };
  const withMembers = (members: object[], nameAliases: object[] = [], prickles: object[] = [], attendees: object[] = []) => {
    repos = createInMemoryRepos(
      new InMemoryDataset({ members: members as never, nameAliases: nameAliases as never, prickles: prickles as never, zoomAttendees: attendees.map((a) => zoomAttendee(a as never)) })
    );
  };
  const prickle = (id: string, title: string, source: string, start: string, end: string, zoomMeetingUuid: string | null = null) => ({
    id, typeId: null, hostId: null, title, startTime: start, endTime: end, source, calendarEventId: null, zoomMeetingUuid,
  });

  it("derives candidates, count and last seen from the data, not from the stored row", async () => {
    // Two members share the first name "Sam", so a bare "Sam" is ambiguous.
    withMembers([ADA, SAM_ADA, SAM_FERN], [], [], [
      { name: "Sam", email: null, join_time: "2026-10-01T00:00:00Z", meeting_uuid: "m1", meeting_id: "1" },
      { name: "Sam", email: null, join_time: "2026-10-05T00:00:00Z", meeting_uuid: "m2", meeting_id: "2" },
      { name: "Sam", email: "other@example.test", join_time: "2026-10-09T00:00:00Z", meeting_uuid: "m3", meeting_id: "3" },
    ]);
    useFakeSupabase({
      ambiguous_zoom_names: { data: [{ zoom_name: "Sam", zoom_email: null, occurrence_count: 4890, last_seen_at: "2026-08-30T00:00:00Z" }] },
    });

    await renderServerPage(AmbiguousNamesPage, {});

    const entries = JSON.parse(screen.getByTestId("entries").textContent!);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ zoomName: "Sam", occurrenceCount: 2, lastSeenAt: "2026-10-05T00:00:00Z" });
    expect(entries[0].candidates.map((c: { id: string }) => c.id).sort()).toEqual([SAM_ADA.id, SAM_FERN.id].sort());
  });

  it("lists the sessions and the members most often there, leaving out the candidates", async () => {
    withMembers(
      [ADA, FERN, SAM_ADA, SAM_FERN],
      [],
      [
        prickle("prkl_AAAAAAAAAAB1", "Monday Prickle", "calendar", "2026-10-04T23:00:00Z", "2026-10-05T01:00:00Z"), // the evening session
        prickle("prkl_AAAAAAAAAAB2", "Thursday Prickle", "zoom", "2026-10-01T00:00:00Z", "2026-10-01T01:00:00Z", "m1"), // the morning one is a pop-up
      ],
      [
        { name: "Sam", email: null, join_time: "2026-10-01T00:00:00Z", topic: "Morning Writing", meeting_uuid: "m1", meeting_id: "1" },
        { name: "Sam", email: null, join_time: "2026-10-05T00:00:00Z", topic: "Evening Writing", meeting_uuid: "m2", meeting_id: "2" },
        { name: ADA.name, email: null, join_time: "2026-10-01T00:00:00Z", topic: "Morning Writing", meeting_uuid: "m1", meeting_id: "1" },
        { name: ADA.name, email: null, join_time: "2026-10-05T00:00:00Z", topic: "Evening Writing", meeting_uuid: "m2", meeting_id: "2" },
        { name: FERN.name, email: null, join_time: "2026-10-05T00:00:00Z", topic: "Evening Writing", meeting_uuid: "m2", meeting_id: "2" },
        { name: SAM_FERN.name, email: null, join_time: "2026-10-05T00:00:00Z", topic: "Evening Writing", meeting_uuid: "m2", meeting_id: "2" },
      ]
    );
    useFakeSupabase({
      ambiguous_zoom_names: { data: [{ zoom_name: "Sam", zoom_email: null }] },
    });

    await renderServerPage(AmbiguousNamesPage, {});

    const [entry] = JSON.parse(screen.getByTestId("entries").textContent!);
    expect(entry.sessions).toEqual([
      { topic: "Evening Writing", joinTime: "2026-10-05T00:00:00Z", prickleId: "prkl_AAAAAAAAAAB1", prickleTitle: "Monday Prickle" },
      { topic: "Morning Writing", joinTime: "2026-10-01T00:00:00Z", prickleId: "prkl_AAAAAAAAAAB2", prickleTitle: "Thursday Prickle" },
    ]);
    // Ada was at both sessions, Fern at one; the Sam candidates are not listed as company.
    expect(entry.companions).toEqual([
      { id: ADA.id, name: ADA.name, displayName: null, sessions: 2 },
      { id: FERN.id, name: FERN.name, displayName: "Penny", sessions: 1 },
    ]);
  });

  it("counts and lists a session once when the person left and rejoined", async () => {
    withMembers([ADA, SAM_ADA, SAM_FERN], [], [], [
      { name: "Sam", email: null, join_time: "2026-10-01T00:40:00Z", topic: "Link", meeting_uuid: "m1", meeting_id: "1" },
      { name: "Sam", email: null, join_time: "2026-10-01T00:00:00Z", topic: "Link", meeting_uuid: "m1", meeting_id: "1" },
      { name: "Sam", email: null, join_time: "2026-10-05T00:00:00Z", topic: "Link", meeting_uuid: "m2", meeting_id: "2" },
    ]);
    useFakeSupabase({
      ambiguous_zoom_names: { data: [{ zoom_name: "Sam", zoom_email: null }] },
    });

    await renderServerPage(AmbiguousNamesPage, {});

    const [entry] = JSON.parse(screen.getByTestId("entries").textContent!);
    expect(entry.occurrenceCount).toBe(2);
    expect(entry.sessions.map((s: { joinTime: string }) => s.joinTime)).toEqual(["2026-10-05T00:00:00Z", "2026-10-01T00:00:00Z"]);
  });

  it("drops a stored name once an alias settles who it is", async () => {
    withMembers([ADA, SAM_ADA], [{ id: "nal_AAAAAAAAAAA1", member_id: SAM_ADA.id, alias: "Sam", active: true }], [], [
      { name: "Sam", email: null, join_time: "2026-10-01T00:00:00Z" },
    ]);
    useFakeSupabase({
      ambiguous_zoom_names: { data: [{ zoom_name: "Sam", zoom_email: null }] },
    });

    await renderServerPage(AmbiguousNamesPage, {});

    expect(JSON.parse(screen.getByTestId("entries").textContent!)).toEqual([]);
  });
});

describe("merge and fix page", () => {
  it("finds members sharing an email and carries their Stripe customer and subscription standing", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [
          { id: "mbr_AAAAAAAAAAB1", name: "Wren Holloway", email: "wren@example.test", stripeCustomerId: "cus_1" },
          { id: "mbr_AAAAAAAAAAB2", name: "Wren H", email: "wren@example.test" },
          BEA,
        ],
      }),
    );
    useFakeSupabase({ "bronze.stripe_subscriptions": { data: [{ stripe_customer_id: "cus_1" }] } });

    await renderServerPage(MergeFixPage, {});

    const groups = JSON.parse(screen.getByTestId("groups").textContent!);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual(expect.arrayContaining([{ id: "mbr_AAAAAAAAAAB1", stripe: "cus_1", active: true }, { id: "mbr_AAAAAAAAAAB2", stripe: null, active: false }]));
  });
});

describe("missing member data page", () => {
  it("lists active members with no Stripe customer, by name", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [
          { ...FERN, stripeCustomerId: "cus_fern" },
          { ...BEA, kajabiId: "kaj-bea" },
          { ...ADA, status: "cancelled" },
          { id: "mbr_AAAAAAAAAAB3", name: "Zed Example", email: "zed@example.test" },
        ],
      }),
    );
    useFakeSupabase({});

    await renderServerPage(MissingMemberDataPage, {});

    expect(screen.getByText("Bea Example")).toBeInTheDocument();
    expect(screen.getByText("Zed Example")).toBeInTheDocument();
    expect(screen.queryByText("Fern Example")).not.toBeInTheDocument(); // has a Stripe customer
    expect(screen.queryByText("Ada Example")).not.toBeInTheDocument(); // not active
  });
});
