import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { eventSeed } from "@/tests/helpers/event-fixtures";
import { createInMemoryRepos } from "@/lib/data/repos";
import {
  MEMBER_IDENTITY,
  MEMBER_USER,
  authModule,
  signInAs,
  sudoModule,
  resetServerPageMocks,
  supabaseServerModule,
} from "@/tests/helpers/server-page";

vi.mock("@/lib/auth", () => authModule);
vi.mock("@/lib/sudo", () => sudoModule);
vi.mock("@/lib/supabase/server", () => supabaseServerModule);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/timezone", () => ({ getUserTimezonePreference: vi.fn(async () => "America/New_York"), getUserSecondaryTimezone: vi.fn(async () => null) }));
vi.mock("@/lib/prickle-checkin-dms", () => ({ resolveAnsweredCheckinNotifications: vi.fn() }));
// Prickles come from their repository, in memory here.
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

import { addEventToMyCalendar, addPrickleToMyCalendar } from "@/app/(member)/my-prickles/calendar-feed-actions";
import { getCheckModalData } from "@/app/(member)/prickles/checkin-actions";

const SPRINT = { id: "prty_AAAAAAAAAAA1", name: "Sprint", normalizedName: "sprint", purpose: "writing", requiresHost: false, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false };
const HOST = { id: "mbr_AAAAAAAAAAA9", name: "Jenn Parker" };
const prickle = (id: string, typeId: string | null, extra: object = {}) => ({
  id,
  typeId,
  hostId: HOST.id,
  title: null,
  startTime: "2097-03-03T15:00:00Z", // a Sunday, 10:00 in New York
  endTime: "2097-03-03T16:00:00Z",
  source: "calendar",
  calendarEventId: null,
  ...extra,
});

beforeEach(() => {
  resetServerPageMocks();
  signInAs(MEMBER_USER, MEMBER_IDENTITY);
  repos = createInMemoryRepos(
    new InMemoryDataset({
      members: [HOST],
      prickleTypes: [SPRINT],
      prickles: [prickle("prkl_AAAAAAAAAAA1", SPRINT.id), prickle("prkl_AAAAAAAAAAA2", null)],
    }),
  );
});

// What the member now has on their calendar feed (the twin's items, as the feed stores them).
const added = () => repos.calendarFeed.itemsOf(MEMBER_IDENTITY.memberId);

describe("addPrickleToMyCalendar", () => {
  it("adds just this prickle by id", async () => {

    expect(await addPrickleToMyCalendar("prkl_AAAAAAAAAAA1", "once")).toEqual({ ok: true });
    expect(await addPrickleToMyCalendar("prkl_AAAAAAAAAAA1", "once")).toEqual({ ok: true }); // already there counts as added

    expect(await added()).toEqual([expect.objectContaining({ kind: "prickle", prickle_id: "prkl_AAAAAAAAAAA1" })]);
  });

  it("adds its weekly slot: the type, and the weekday and start time in the schedule's timezone", async () => {

    expect(await addPrickleToMyCalendar("prkl_AAAAAAAAAAA1", "weekly")).toEqual({ ok: true });

    expect(await added()).toEqual([expect.objectContaining({ kind: "slot", type_id: SPRINT.id, day_of_week: 0, start_time_local: "10:00:00" })]);
  });

  it("refuses a prickle that is gone, one without a type, and an unknown mode", async () => {

    expect(await addPrickleToMyCalendar("prkl_ZZZZZZZZZZZZ", "once")).toEqual({ error: "That prickle isn't on the schedule anymore." });
    expect(await addPrickleToMyCalendar("prkl_AAAAAAAAAAA2", "once")).toEqual({ error: "That prickle can't be added to your calendar." });
    expect(await addPrickleToMyCalendar("prkl_AAAAAAAAAAA1", "daily" as never)).toEqual({ error: "Invalid option" });
    expect(await added()).toEqual([]);
  });

  it("answers with the error message and adds nothing when the database refuses", async () => {
    vi.spyOn(repos.calendarFeed, "addItem").mockRejectedValueOnce(new Error("database is down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await addPrickleToMyCalendar("prkl_AAAAAAAAAAA1", "once")).toEqual({ error: "Couldn't add that to your calendar. Please try again." });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("addEventToMyCalendar", () => {
  it("adds a visible event, and refuses a hidden or unknown one", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        ...eventSeed([
          { id: "evnt_AAAAAAAAAAA1", slug: "retreat", title: "Retreat" },
          { id: "evnt_AAAAAAAAAAA2", slug: "secret", title: "Secret", deleted_at: "2097-01-01T00:00:00Z" },
        ]),
      }),
    );

    expect(await addEventToMyCalendar("evnt_AAAAAAAAAAA1")).toEqual({ ok: true });
    expect(await added()).toEqual([expect.objectContaining({ kind: "event", event_id: "evnt_AAAAAAAAAAA1" })]);

    expect(await addEventToMyCalendar("evnt_AAAAAAAAAAA2")).toEqual({ error: "That event couldn't be found." });
    expect(await addEventToMyCalendar("evnt_ZZZZZZZZZZZZ")).toEqual({ error: "That event couldn't be found." });
    expect(await added()).toHaveLength(1);
  });
});

describe("getCheckModalData", () => {
  it("names the prickle the way the page does and says whether it has started", async () => {

    const data = await getCheckModalData("prkl_AAAAAAAAAAA1");

    expect(data).toMatchObject({ prickleTitle: "Sunday Sprint with Jenn P", entryDate: "2097-03-03", hasStarted: false, canEdit: true, projects: [] });
  });

  it("is null for a prickle that doesn't exist", async () => {

    expect(await getCheckModalData("prkl_ZZZZZZZZZZZZ")).toBeNull();
  });
});
