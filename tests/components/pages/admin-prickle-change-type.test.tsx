// @vitest-environment jsdom
/**
 * The admin prickle page's "Change type": a calendar prickle filed under the wrong type is moved, and the
 * choice is stored as the calendar event's resolved decision so reprocessing keeps it.
 */
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TYPE_A = "prty_AAAAAAAAAAA1";
const TYPE_B = "prty_AAAAAAAAAAA2";
const CAL = "00000000-0000-4000-8000-00000000000a";
const type = (id: string, name: string) => ({ id, name, normalizedName: name.toLowerCase(), purpose: "writing" as const, requiresHost: false, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false });
const prickle = (id: string, calendarEventId: string | null) => ({ id, typeId: TYPE_A, hostId: null, title: null, startTime: "2026-10-05T17:00:00Z", endTime: "2026-10-05T18:00:00Z", source: "calendar" as const, calendarEventId });

let repos: ReturnType<typeof createInMemoryRepos>;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

// A minimal stand-in for the two tables the action touches, recording what it writes.
let unmatched: Record<string, unknown>[];
let summaries: Record<string, string>;
let writes: { op: string; row: unknown }[];
const supabase = {
  schema: () => ({ from: () => ({ select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: summaries[id] ? { summary: summaries[id] } : null }) }) }) }) }),
  from: () => ({
    select: () => ({ eq: async (_c: string, id: string) => ({ data: unmatched.filter((r) => r.calendar_event_id === id).map((r) => ({ id: r.id })), error: null }) }),
    update: (row: unknown) => ({ eq: async () => (writes.push({ op: "update", row }), { error: null }) }),
    insert: async (row: unknown) => (writes.push({ op: "insert", row }), { error: null }),
  }),
};
let admin = true;
vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: async () => (admin ? { ok: true, supabase, user: { id: "u1" } } : { ok: false, error: "Not authorized" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("@/lib/prickle-checkin-dms", () => ({ sendTestCheckinDM: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: vi.fn() }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { changePrickleType } from "@/app/(admin)/admin/prickles/[id]/actions";
import ChangePrickleType from "@/app/(admin)/admin/prickles/[id]/ChangePrickleType";

beforeEach(() => {
  admin = true;
  unmatched = [];
  summaries = { [CAL]: "HEDGIE HOUSE BOOK FAIR INTRO!" };
  writes = [];
  repos = createInMemoryRepos(new InMemoryDataset({ prickleTypes: [type(TYPE_A, "Hedgie-A-Thon"), type(TYPE_B, "Book Fair")], prickles: [prickle("p1", CAL), prickle("p2", null)] }));
});
afterEach(cleanup);

describe("changePrickleType", () => {
  it("rewrites an earlier decision for the calendar event and moves the prickle", async () => {
    unmatched = [{ id: "u1", calendar_event_id: CAL }];

    await expect(changePrickleType("p1", TYPE_B)).resolves.toEqual({ success: true });

    expect(writes).toEqual([{ op: "update", row: expect.objectContaining({ status: "resolved", resolved_type_id: TYPE_B }) }]);
    expect((await repos.prickles.byId("p1"))?.typeId).toBe(TYPE_B);
  });

  it("records a decision when the event was matched automatically", async () => {
    await expect(changePrickleType("p1", TYPE_B)).resolves.toEqual({ success: true });

    expect(writes).toEqual([{ op: "insert", row: expect.objectContaining({ calendar_event_id: CAL, raw_summary: "HEDGIE HOUSE BOOK FAIR INTRO!", status: "resolved", resolved_type_id: TYPE_B }) }]);
  });

  it("changes nothing when the calendar event is gone", async () => {
    summaries = {};

    expect(await changePrickleType("p1", TYPE_B)).toEqual({ error: "The calendar event is gone, so the change wouldn't last" });
    expect((await repos.prickles.byId("p1"))?.typeId).toBe(TYPE_A);
  });

  it("refuses a non-admin, a missing prickle, a prickle without a calendar event and an unknown type", async () => {
    expect(await changePrickleType("p1", "prty_ZZZZZZZZZZZ9")).toEqual({ error: "Unknown prickle type" });
    expect(await changePrickleType("nope", TYPE_B)).toEqual({ error: "Prickle not found" });
    expect(await changePrickleType("p2", TYPE_B)).toEqual({ error: "Only prickles made from a calendar event can change type here" });
    admin = false;
    expect(await changePrickleType("p1", TYPE_B)).toEqual({ error: "Not authorized" });
    expect(writes).toEqual([]);
  });
});

describe("ChangePrickleType", () => {
  const types = [{ id: TYPE_A, name: "Hedgie-A-Thon" }, { id: TYPE_B, name: "Book Fair" }];

  it("saves the chosen type and refreshes the page", async () => {
    render(<ChangePrickleType prickleId="p1" currentTypeId={TYPE_A} types={types} />);
    const button = screen.getByRole("button", { name: "Change type" });
    expect(button).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText("Prickle type"), TYPE_B);
    await userEvent.click(button);

    await waitFor(() => expect(screen.getByText("Saved.")).toBeInTheDocument());
    expect((await repos.prickles.byId("p1"))?.typeId).toBe(TYPE_B);
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the error when saving fails", async () => {
    render(<ChangePrickleType prickleId="p2" currentTypeId={TYPE_A} types={types} />);

    await userEvent.selectOptions(screen.getByLabelText("Prickle type"), TYPE_B);
    await userEvent.click(screen.getByRole("button", { name: "Change type" }));

    expect(await screen.findByText("Only prickles made from a calendar event can change type here")).toBeInTheDocument();
  });
});
