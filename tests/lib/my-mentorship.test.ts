import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { badgeHref } from "@/lib/badges";
import { currentMentorships, type MyMentorshipRow } from "@/lib/my-mentorship";

const row = (overrides: Partial<MyMentorshipRow>): MyMentorshipRow => ({
  mentorship_id: "ms-1",
  viewer_role: "new_member",
  other_member_id: "m-ada",
  other_name: "Ada Quill",
  other_display_name: null,
  other_photo_url: null,
  started_on: "2026-06-01",
  trial_ends_on: "2026-06-08",
  kind: "trial",
  outcome_note: null,
  other_status: null,
  other_first_joined_at: null,
  other_most_recent_joined_at: null,
  ...overrides,
});

describe("currentMentorships", () => {
  it("separates a member's big sister from the new members they look after", () => {
    const result = currentMentorships(
      [
        row({}),
        row({ mentorship_id: "ms-2", viewer_role: "big_sister", other_member_id: "m-bea", other_name: "Bea Moss", started_on: "2026-05-30", kind: "direct" }),
        row({ mentorship_id: "ms-3", viewer_role: "big_sister", other_member_id: "m-cleo", other_name: "Cleo Fern", started_on: "2026-06-03" }),
      ],
      "2026-06-10"
    );
    expect(result.bigSister).toMatchObject({ name: "Ada Quill", mentorshipId: "ms-1" });
    expect(result.mentees.map((m) => m.name)).toEqual(["Cleo Fern", "Bea Moss"]);
  });

  it("uses the name the community knows them by", () => {
    const result = currentMentorships([row({ other_display_name: "A. Quill" })], "2026-06-10");
    expect(result.bigSister?.name).toBe("A. Quill");
  });

  it("shows a match for exactly 30 days from when the membership began", () => {
    expect(currentMentorships([row({})], "2026-06-30").bigSister).not.toBeNull();
    expect(currentMentorships([row({})], "2026-07-01").bigSister).toBeNull();
  });

  it("works the same for a direct sign-up or a program arrival as for a trial", () => {
    for (const kind of ["direct", "program"] as const) {
      expect(currentMentorships([row({ kind, trial_ends_on: null })], "2026-06-20").bigSister).not.toBeNull();
    }
  });

  describe("asking the big sister why a trial didn't continue", () => {
    const mentee = (overrides: Partial<MyMentorshipRow> = {}) =>
      row({
        viewer_role: "big_sister",
        other_status: "lead",
        trial_ends_on: "2026-06-08",
        ...overrides,
      });

    it("asks once the trial has ended without a membership", () => {
      const [m] = currentMentorships([mentee()], "2026-06-15").mentees;
      expect(m.canRecordReason).toBe(true);
      expect(m.note).toBeNull();
    });

    it("doesn't ask while the trial is still running or has converted", () => {
      expect(currentMentorships([mentee()], "2026-06-05").mentees[0].canRecordReason).toBe(false);
      const converted = mentee({ other_status: "active", other_first_joined_at: "2026-06-09", other_most_recent_joined_at: "2026-06-09" });
      expect(currentMentorships([converted], "2026-06-15").mentees[0].canRecordReason).toBe(false);
    });

    it("never asks about a member who didn't arrive on a trial", () => {
      expect(currentMentorships([mentee({ kind: "direct", trial_ends_on: null })], "2026-06-15").mentees[0].canRecordReason).toBe(false);
    });

    it("keeps the match on the page after the 30 days, so the reason can still be written", () => {
      const after = currentMentorships([mentee()], "2026-07-15");
      expect(after.mentees).toHaveLength(1);
      expect(after.mentees[0].canRecordReason).toBe(true);
    });

    it("stops asking after 60 days, and drops a match with nothing to say", () => {
      expect(currentMentorships([mentee()], "2026-08-05").mentees).toEqual([]);
      const converted = mentee({ other_status: "active", other_first_joined_at: "2026-06-09", other_most_recent_joined_at: "2026-06-09" });
      expect(currentMentorships([converted], "2026-07-15").mentees).toEqual([]);
    });

    it("hands back the note already written", () => {
      expect(currentMentorships([mentee({ outcome_note: "price" })], "2026-06-15").mentees[0].note).toBe("price");
    });

    it("tells a new member nothing about any of this", () => {
      const result = currentMentorships([row({ other_status: "lead" })], "2026-06-15");
      expect(result.bigSister).not.toHaveProperty("canRecordReason");
      expect(result.bigSister).not.toHaveProperty("note");
    });
  });
});

describe("badgeHref", () => {
  it("links the Big Sister badge to the program page, only for a viewer with the big_sisters preview, and retreats to their event", () => {
    expect(badgeHref({ key: "hedgie_mentor", event_slug: null }, { bigSistersEnabled: true })).toBe("/big-sisters");
    expect(badgeHref({ key: "hedgie_mentor", event_slug: null })).toBeNull();
    expect(badgeHref({ key: "hedgie_mentor", event_slug: null }, { bigSistersEnabled: false })).toBeNull();
    expect(badgeHref({ key: "fall_2025_virtual_retreat", event_slug: "fall-2025" })).toBe("/events/fall-2025");
    expect(badgeHref({ key: "hostess", event_slug: null })).toBeNull();
  });
});

const createNotifier = vi.fn();
vi.mock("@/lib/notifications/notify", () => ({ createNotifier: (...a: unknown[]) => createNotifier(...a) }));
// Who has the big_sisters preview on; each test sets it.
let flagged = new Set<string>();
vi.mock("@/lib/features.server", () => ({ membersWithFeature: async () => flagged }));

let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

import { sendMatchIntroductions } from "@/lib/mentorship-intro";

describe("sendMatchIntroductions", () => {
  // Names come from the members repository (in memory here); the client is only handed through.
  const service = (members: { id: string; name: string; displayName: string | null }[]) => {
    repos = createInMemoryRepos(new InMemoryDataset({ members }));
    return {} as never;
  };
  const members = [
    { id: "mentor", name: "Ada Quill", displayName: null },
    { id: "new", name: "Bea Moss", displayName: null },
  ];
  const match = { mentorMemberId: "mentor", newMemberId: "new", startedOn: "2026-06-01" };

  beforeEach(() => {
    flagged = new Set(["mentor", "new"]);
  });

  it("tells each person who the other is", async () => {
    const send = vi.fn().mockResolvedValue(["slack"]);
    createNotifier.mockResolvedValue({ canReach: () => true, send });
    await sendMatchIntroductions(service(members), match, "2026-06-02");
    expect(createNotifier).toHaveBeenCalledWith(expect.anything(), "big_sister_match", ["new", "mentor"]);
    expect(send).toHaveBeenCalledWith("new", expect.objectContaining({ text: expect.stringContaining("Ada Quill") }));
    expect(send).toHaveBeenCalledWith("mentor", expect.objectContaining({ text: expect.stringContaining("Bea Moss") }));
  });

  it("only tells members who have the big_sisters preview", async () => {
    const send = vi.fn().mockResolvedValue(["slack"]);
    createNotifier.mockResolvedValue({ canReach: () => true, send });
    flagged = new Set(["mentor"]);
    await sendMatchIntroductions(service(members), match, "2026-06-02");
    expect(createNotifier).toHaveBeenLastCalledWith(expect.anything(), "big_sister_match", ["mentor"]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("mentor", expect.anything());
  });

  it("sends nothing at all while nobody involved has the preview", async () => {
    createNotifier.mockClear();
    flagged = new Set();
    await sendMatchIntroductions(service(members), match, "2026-06-02");
    expect(createNotifier).not.toHaveBeenCalled();
  });

  it("skips someone who can't be reached", async () => {
    const send = vi.fn().mockResolvedValue([]);
    createNotifier.mockResolvedValue({ canReach: (id: string) => id === "mentor", send });
    await sendMatchIntroductions(service(members), match, "2026-06-02");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("mentor", expect.anything());
  });

  it("sends nothing for a match whose 30 days are already up", async () => {
    createNotifier.mockClear();
    await sendMatchIntroductions(service(members), match, "2026-09-01");
    expect(createNotifier).not.toHaveBeenCalled();
  });

  it("never throws: the match is saved either way", async () => {
    createNotifier.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendMatchIntroductions(service(members), match, "2026-06-02")).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
