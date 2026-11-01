import { describe, it, expect, vi } from "vitest";

// The hosting slot picker shows who hosts each prickle and proposed slot: by display name.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn().mockResolvedValue({ id: "u1", email: "viewer@example.com" }) }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const dataset = new InMemoryDataset({
  members: [
    { id: "mbr_AAAAAAAAAAA1", name: "Laura May Best", displayName: "Bestie" },
    { id: "mbr_AAAAAAAAAAA2", name: "Ann Example", displayName: null },
  ],
  prickleTypes: [{ id: "ptyp_AAAAAAAAAAA1", name: "Midnight Crew", normalizedName: "midnight crew", purpose: "writing", requiresHost: true, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false }],
  prickles: [
    { id: "prkl_AAAAAAAAAAA1", typeId: "ptyp_AAAAAAAAAAA1", hostId: "mbr_AAAAAAAAAAA1", title: null, startTime: "2026-11-03T15:00:00Z", endTime: "2026-11-03T16:00:00Z", source: "calendar", calendarEventId: null },
    { id: "prkl_AAAAAAAAAAA2", typeId: "ptyp_AAAAAAAAAAA1", hostId: "mbr_AAAAAAAAAAA2", title: null, startTime: "2026-11-04T15:00:00Z", endTime: "2026-11-04T16:00:00Z", source: "calendar", calendarEventId: null },
  ],
});
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  return { ...actual, createRepos: () => actual.createInMemoryRepos(dataset) };
});

import { InMemoryDataset } from "@/lib/data/in-memory";
import { createClient } from "@/lib/supabase/server";
import { getHostingCalendarContext } from "@/app/(member)/hosting/actions";

const scheduleRow = (id: string, host_id: string) => ({
  id,
  host_id,
  type_id: "ptyp_AAAAAAAAAAA1",
  month: "2026-11-01",
  recurrence_type: "one_off",
  day_of_week: null,
  recurrence_anchor_date: null,
  week_of_month: null,
  event_date: "2026-11-10",
  start_time_local: "10:00:00",
  timezone: "America/New_York",
  status: "proposed",
  notes: null,
  deleted_at: null,
  deleted_by: null,
  carried_forward_from: null,
  confirmed_by: null,
  confirmed_at: null,
  updated_by: null,
  updated_at: "2026-10-01T00:00:00Z",
  created_at: "2026-10-01T00:00:00Z",
});

describe("getHostingCalendarContext", () => {
  it("names hosts by display name, falling back to the legal name", async () => {
    vi.mocked(createClient).mockResolvedValue({} as never);

    const { prickles } = await getHostingCalendarContext("2026-11-01");

    expect(prickles.map((p) => p.host).sort()).toEqual(["Ann Example", "Bestie"]);
  });

  it("labels proposed slots with the host's display name", async () => {
    // s3's host is not a member any more.
    dataset.prickleSchedules = [scheduleRow("s1", "mbr_AAAAAAAAAAA1"), scheduleRow("s2", "mbr_AAAAAAAAAAA2"), scheduleRow("s3", "mbr_AAAAAAAAAAA9")];
    vi.mocked(createClient).mockResolvedValue({} as never);

    const { proposedSlots } = await getHostingCalendarContext("2026-11-01");

    expect(proposedSlots.map((s) => s.label)).toEqual(["Midnight Crew — Bestie", "Midnight Crew — Ann Example", "Midnight Crew — a host"]);
  });
});
