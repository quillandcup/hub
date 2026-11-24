import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";
import type { ThreadComment, ThreadEntry } from "@/lib/data/course-comments";
import { MAX_MENTIONS, mentionError, mentionNames, suggestMentionable } from "@/lib/courses/comment-mentions";

vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));

const COURSE = "crs_AAAAAAAAAAA1";
const NOW = new Date("2027-03-02T15:00:00Z");
const ADA = "mbr_AAAAAAAAAAA1";
const BEA = "mbr_AAAAAAAAAAA2";
const STAFF = "mbr_AAAAAAAAAAA3";
const ENDED = "mbr_AAAAAAAAAAA4";
const OUTSIDER = "mbr_AAAAAAAAAAA5";
const token = (id: string) => `@[${id}]`;

let repos: Repos;
beforeEach(() => {
  const names: Record<string, string> = { [ADA]: "Ada Example", [BEA]: "Beatrice <Bea> & Co", [STAFF]: "Sam Staff", [ENDED]: "Eli Example", [OUTSIDER]: "Olive Outsider" };
  const dataset = new InMemoryDataset({
    members: Object.entries(names).map(([id, name]) => ({ id, name, firstJoinedAt: "2024-01-01", userId: `u-${id}` })),
    userProfiles: [{ id: `u-${STAFF}`, email: "staff@example.test", role: "admin" }],
    courses: [{ id: COURSE, slug: "story-basics", title: "Story Basics" } as never],
    courseAccess: [
      ...[ADA, BEA].map((member_id) => ({ member_id, course_id: COURSE, starts_at: "2027-01-01T00:00:00Z", ends_at: null, origin: "purchase" })),
      { member_id: ENDED, course_id: COURSE, starts_at: "2026-01-01T00:00:00Z", ends_at: "2027-02-01T00:00:00Z", origin: "purchase" },
    ],
  });
  repos = createInMemoryRepos(dataset);
});

describe("mentionError", () => {
  it("allows no mentions, course members and staff", async () => {
    expect(await mentionError(repos, COURSE, "Nobody here", NOW)).toBeNull();
    expect(await mentionError(repos, COURSE, `${token(ADA)} ${token(STAFF)}`, NOW)).toBeNull();
  });

  it("refuses a member whose access ended, someone outside the course, and too many people", async () => {
    const outside = "You can only mention people who are in this course";
    expect(await mentionError(repos, COURSE, token(ENDED), NOW)).toBe(outside);
    expect(await mentionError(repos, COURSE, `${token(ADA)} ${token(OUTSIDER)}`, NOW)).toBe(outside);
    const many = Array.from({ length: MAX_MENTIONS + 1 }, (_, i) => token(`mbr_AAAAAAAAAA${i + 1}x`)).join(" ");
    expect(await mentionError(repos, COURSE, many, NOW)).toBe(`Mention up to ${MAX_MENTIONS} people in one comment`);
  });
});

describe("mentionNames", () => {
  const comment = (id: string, body: string | null): ThreadComment => ({
    id, lessonId: "les_AAAAAAAAAAA1", memberId: ADA, parentId: null, authorName: "Ada", isStaffReply: false, createdAt: NOW.toISOString(), editedAt: null, removed: body === null, body, hidden: false, held: false,
  });

  it("names those who can still open the course, from the comments and their replies, and nobody else", async () => {
    const entries: ThreadEntry[] = [
      { comment: comment("cmnt_AAAAAAAAAAA1", `Hi ${token(BEA)}`), replies: [comment("cmnt_AAAAAAAAAAA2", `cc ${token(STAFF)} ${token(ENDED)} ${token(OUTSIDER)}`)] },
      { comment: comment("cmnt_AAAAAAAAAAA3", null), replies: [] },
    ];

    expect(await mentionNames(repos, COURSE, entries, NOW)).toEqual({ [BEA]: "Beatrice <Bea> & Co", [STAFF]: "Sam Staff" });
  });

  it("reads nothing when no comment mentions anyone", async () => {
    expect(await mentionNames(repos, COURSE, [{ comment: comment("cmnt_AAAAAAAAAAA1", "Plain"), replies: [] }], NOW)).toEqual({});
  });
});

describe("suggestMentionable", () => {
  it("offers course members and staff whose name matches, staff badged, never the writer, an ended member or an outsider", async () => {
    expect((await suggestMentionable(repos, COURSE, ADA, "a", NOW)).map((c) => c.name)).toEqual(["Sam Staff", "Beatrice <Bea> & Co"]);
    expect(await suggestMentionable(repos, COURSE, ADA, "sam", NOW)).toEqual([{ memberId: STAFF, name: "Sam Staff", isInstructor: true }]);
    expect(await suggestMentionable(repos, COURSE, ADA, "eli", NOW)).toEqual([]);
    expect(await suggestMentionable(repos, COURSE, ADA, "olive", NOW)).toEqual([]);
    expect(await suggestMentionable(repos, COURSE, ADA, "ada", NOW)).toEqual([]);
  });

  it("puts names that start with the query first, and offers nothing for an empty one", async () => {
    expect((await suggestMentionable(repos, COURSE, BEA, "a", NOW)).map((c) => c.name)[0]).toBe("Ada Example");
    expect(await suggestMentionable(repos, COURSE, ADA, "   ", NOW)).toEqual([]);
  });
});
