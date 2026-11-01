import { describe, it, expect, vi, beforeEach } from "vitest";

// saveHostVibe never takes a host_id parameter from the caller — it's always
// derived from getEffectiveIdentity, which is the actual authorization
// boundary here (RLS on prickle_host_vibes is permissive, per this project's
// convention). These tests verify that boundary holds, including under sudo.

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/sudo", () => ({
  getEffectiveIdentity: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/timezone", () => ({
  getUserTimezonePreference: vi.fn().mockResolvedValue("America/New_York"),
}));

import { getHostedVibes, getWizardRecommendations, saveHostVibe } from "@/app/(member)/prickle-picker/actions";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryPrickleRepository } from "@/lib/data/prickles";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";

// The host-vibe tests below run on the in-memory repositories; the recommendation tests further down
// still answer the repositories' queries with a fake client.
let twin: Repos | null = null;
let data = new InMemoryDataset();
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  return { ...actual, createRepos: (db: Parameters<typeof actual.createRepos>[0]) => twin ?? actual.createRepos(db) };
});

const HOSTS = ["member-1", "sudo-target-member", "new-host"];

/** The acting member hosts the type through a prickle (or, with `signupOnly`, only through this month's signup), or does not. */
function useHost({ hostsType, signupOnly = false }: { hostsType: boolean; signupOnly?: boolean }) {
  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  data = new InMemoryDataset({
    members: HOSTS.map((id) => ({ id, name: id })),
    prickleTypes: [{ id: "type-a", name: "Writing", normalizedName: "writing", purpose: "writing", requiresHost: true, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false }],
    prickles:
      hostsType && !signupOnly
        ? HOSTS.map((hostId, i) => ({ id: `prkl_AAAAAAAAAAA${i}`, typeId: "type-a", hostId, title: null, startTime: now.toISOString(), endTime: now.toISOString(), source: "calendar", calendarEventId: null }))
        : [],
    prickleSchedules:
      hostsType && signupOnly
        ? (HOSTS.map((host_id, i) => ({
            id: `psch_AAAAAAAAAAA${i}`, host_id, type_id: "type-a", month, recurrence_type: "weekly", day_of_week: 2, week_of_month: null, recurrence_anchor_date: null, event_date: null,
            start_time_local: "19:00", timezone: "America/New_York", status: "confirmed", notes: null, deleted_at: null, deleted_by: null, carried_forward_from: null, confirmed_by: null,
            confirmed_at: null, updated_by: null, updated_at: "2026-09-01T00:00:00Z", created_at: "2026-09-01T00:00:00Z",
          })) as never)
        : [],
  });
  twin = createInMemoryRepos(data);
}

const supabase = {
  auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "auth-user-1" } }, error: null }) },
};

beforeEach(() => {
  vi.clearAllMocks();
  twin = null;
  supabase.auth.getClaims = vi.fn().mockResolvedValue({ data: { claims: { sub: "auth-user-1" } }, error: null });
  vi.mocked(createClient).mockResolvedValue(supabase as any);
});

const tagged = () => data.hostVibes.map((v) => ({ type_id: v.type_id, host_id: v.host_id, vibe: v.vibe, notes: v.notes }));

describe("saveHostVibe authorization scoping", () => {
  it("rejects when there is no authenticated user", async () => {
    useHost({ hostsType: true });
    supabase.auth.getClaims = vi.fn().mockResolvedValue({ data: null, error: null });

    const result = await saveHostVibe("type-a", "chatty", "");
    expect(result).toEqual({ error: "Not authenticated" });
    expect(tagged()).toEqual([]);
  });

  it("rejects when the authenticated user has no member record", async () => {
    useHost({ hostsType: true });
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);

    const result = await saveHostVibe("type-a", "chatty", "");
    expect(result).toEqual({ error: "No member record" });
    expect(tagged()).toEqual([]);
  });

  it("rejects when the acting member does not host the given type", async () => {
    useHost({ hostsType: false });
    vi.mocked(getEffectiveIdentity).mockResolvedValue({
      memberId: "member-1",
      memberName: "Member One",
      memberEmail: "m1@example.com",
      isSudo: false,
    });

    const result = await saveHostVibe("type-a", "chatty", "");
    expect(result).toEqual({ error: "You can only tag prickle types you host" });
    expect(tagged()).toEqual([]);
  });

  it("scopes the write to the acting member's own host_id", async () => {
    useHost({ hostsType: true });
    vi.mocked(getEffectiveIdentity).mockResolvedValue({
      memberId: "member-1",
      memberName: "Member One",
      memberEmail: "m1@example.com",
      isSudo: false,
    });

    const result = await saveHostVibe("type-a", "chatty", "opens with a check-in");
    expect(result).toEqual({ success: true });
    expect(tagged()).toEqual([{ type_id: "type-a", host_id: "member-1", vibe: "chatty", notes: "opens with a check-in" }]);
  });

  it("scopes the write to the sudo'd member, not the real admin, while sudo'd", async () => {
    useHost({ hostsType: true });
    // getEffectiveIdentity already resolves to the sudo'd member's own id —
    // saveHostVibe has no separate admin-id parameter to leak through.
    vi.mocked(getEffectiveIdentity).mockResolvedValue({
      memberId: "sudo-target-member",
      memberName: "Sudo Target",
      memberEmail: "target@example.com",
      isSudo: true,
    });

    await saveHostVibe("type-a", "focused", "");
    expect(tagged()).toEqual([{ type_id: "type-a", host_id: "sudo-target-member", vibe: "focused", notes: null }]);
  });

  it("lists configurable types for a first-time host's signup", async () => {
    useHost({ hostsType: true, signupOnly: true });
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ memberId: "new-host", memberName: "New Host", memberEmail: "host@example.com", isSudo: false });
    expect(await getHostedVibes()).toEqual([{ typeId: "type-a", typeName: "Writing", vibe: "balanced", notes: "" }]);
  });

  it("shows the tag a host saved, and the default for a type not tagged yet", async () => {
    useHost({ hostsType: true });
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ memberId: "member-1", memberName: "Member One", memberEmail: "m1@example.com", isSudo: false });
    await saveHostVibe("type-a", "chatty", "lively");
    expect(await getHostedVibes()).toEqual([{ typeId: "type-a", typeName: "Writing", vibe: "chatty", notes: "lively" }]);
  });

  it("is empty for a member who hosts nothing, and for no signed-in user", async () => {
    useHost({ hostsType: false });
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ memberId: "member-1", memberName: "Member One", memberEmail: "m1@example.com", isSudo: false });
    expect(await getHostedVibes()).toEqual([]);

    supabase.auth.getClaims = vi.fn().mockResolvedValue({ data: null, error: null });
    expect(await getHostedVibes()).toEqual([]);
    supabase.auth.getClaims = vi.fn().mockResolvedValue({ data: { claims: { sub: "auth-user-1" } }, error: null });
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);
    expect(await getHostedVibes()).toEqual([]);
  });

  it("lets a new host save vibes using their signup before hosting a prickle", async () => {
    useHost({ hostsType: true, signupOnly: true });
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ memberId: "new-host", memberName: "New Host", memberEmail: "host@example.com", isSudo: false });
    expect(await saveHostVibe("type-a", "focused", "Quiet writing")).toEqual({ success: true });
    expect(tagged()).toEqual([{ type_id: "type-a", host_id: "new-host", vibe: "focused", notes: "Quiet writing" }]);
  });

  it("surfaces a database error from the upsert", async () => {
    useHost({ hostsType: true });
    vi.spyOn(InMemoryPrickleRepository.prototype, "saveHostVibe").mockRejectedValueOnce(new Error("constraint violation"));
    vi.mocked(getEffectiveIdentity).mockResolvedValue({
      memberId: "member-1",
      memberName: "Member One",
      memberEmail: "m1@example.com",
      isSudo: false,
    });

    const result = await saveHostVibe("type-a", "chatty", "");
    expect(result).toEqual({ error: "constraint violation" });
  });
});

// ---------------------------------------------------------------------------
// getWizardRecommendations: feelings + personal history
// ---------------------------------------------------------------------------

/** A chainable query fake: every filter returns itself, awaiting resolves the table's rows. */
function makeQueryFake(tables: Record<string, unknown[]>) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const from = vi.fn((table: string) => {
    const result = { data: tables[table] ?? [], error: null };
    const builder: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };
    for (const method of ["select", "eq", "gte", "lte", "lt", "order", "not", "is", "in", "range"]) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        builder.maybeSingle = () => Promise.resolve({ data: null, error: null }); // the Event type lookup: none to leave out
    return builder;
      };
    }
    builder.maybeSingle = () => Promise.resolve({ data: null, error: null }); // the Event type lookup: none to leave out
    return builder;
  });
  return {
    client: {
      auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "auth-user-1" } }, error: null }) },
      from,
    },
    calls,
  };
}

const MEMBER = { memberId: "member-1", memberName: "Member One", memberEmail: "m1@example.com", isSudo: false };
const BASE_ANSWERS = { windowDays: 7, timeOfDay: "any" as const, vibe: "any" as const, purpose: "any" as const, withMemberIds: [] };

describe("getWizardRecommendations", () => {
  it("rejects a feeling that isn't on the wheel before querying anything", async () => {
    const fake = makeQueryFake({});
    vi.mocked(createClient).mockResolvedValue(fake.client as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(MEMBER);

    const result = await getWizardRecommendations({
      ...BASE_ANSWERS,
      mood: { pleasant: 2, energy: 4, emotion: "hangry" as any },
    });
    expect(result).toEqual({ error: "Invalid feeling" });
    expect(fake.client.from).not.toHaveBeenCalled();
  });

  it("names each series' host by display name", async () => {
    const soon = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
    const fake = makeQueryFake({
      prickle_types: [{ id: "t1", name: "Heads Down", purpose: "writing", solo_task_friendly: true }],
      member_directory: [
        { id: "host-a", name: "Laura May Best", display_name: "Bestie" },
        { id: "host-b", name: "Ann Example", display_name: null },
      ],
      prickles: [
        { id: "p-a", type_id: "t1", host_id: "host-a", start_time: soon(2) },
        { id: "p-b", type_id: "t1", host_id: "host-b", start_time: soon(3) },
      ],
      prickle_host_vibes: [],
      prickle_attendance: [],
      prickle_checkins: [],
    });
    vi.mocked(createClient).mockResolvedValue(fake.client as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(MEMBER);

    const result = await getWizardRecommendations({ ...BASE_ANSWERS, mood: { pleasant: 2, energy: 4, emotion: null }, need: null });
    if ("error" in result) throw new Error(result.error);

    expect(Object.fromEntries(result.recommendations.map((r) => [r.hostId, r.hostName]))).toEqual({ "host-a": "Bestie", "host-b": "Ann Example" });
  });

  it("ranks with how well each series met the member's intention at similar times", async () => {
    const soon = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
    const fake = makeQueryFake({
      prickle_types: [{ id: "t1", name: "Heads Down", purpose: "writing", solo_task_friendly: true }],
      member_directory: [],
      prickles: [
        { id: "p-a", type_id: "t1", host_id: "host-a", start_time: soon(2) },
        { id: "p-b", type_id: "t1", host_id: "host-b", start_time: soon(3) },
      ],
      prickle_host_vibes: [],
      prickle_attendance: [],
      prickle_checkins: [
        { pleasant_before: 2, energy_before: 4, emotion_before: null, need: null, intention_met: 5, prickles: { type_id: "t1", host: "host-b" } },
        { pleasant_before: 2, energy_before: 5, emotion_before: null, need: null, intention_met: 5, prickles: { type_id: "t1", host: "host-b" } },
        { pleasant_before: 5, energy_before: 1, emotion_before: null, need: null, intention_met: 1, prickles: { type_id: "t1", host: "host-a" } },
      ],
    });
    vi.mocked(createClient).mockResolvedValue(fake.client as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(MEMBER);

    const result = await getWizardRecommendations({ ...BASE_ANSWERS, mood: { pleasant: 2, energy: 4, emotion: null }, need: null });
    if ("error" in result) throw new Error(result.error);

    expect(result.recommendations[0].hostId).toBe("host-b");
    expect(result.recommendations[0].personal).toEqual({ sessions: 2, avgRating: 5 });
    expect(fake.calls).toContainEqual({ table: "prickle_checkins", method: "eq", args: ["member_id", "member-1"] });
    expect(fake.calls).toContainEqual({ table: "prickle_checkins", method: "not", args: ["intention_met", "is", null] });
    expect(fake.calls).toContainEqual({ table: "prickle_checkins", method: "is", args: ["deleted_at", null] });
  });
});
