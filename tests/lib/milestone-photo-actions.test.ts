import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { MILESTONE_PHOTO } from "@/lib/config";

const ADA = "mbr_AAAAAAAAAAA1";
const BO = "mbr_AAAAAAAAAAA2";
const USER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-20T15:00:00Z");
const PATH = `${ADA}/${"a".repeat(32)}.webp`;

let data: InMemoryDataset;
const recorded: Array<{ action: string; outcome: unknown }> = [];
const removedFiles: string[] = [];

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => ({
    storage: {
      from: (bucket: string) => {
        expect(bucket).toBe("milestone-photos");
        return {
          remove: async (paths: string[]) => {
            removedFiles.push(...paths);
            return { error: null };
          },
        };
      },
    },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("@/lib/writer-profiles-access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/writer-profiles-access")>();
  return { ...actual, memberHasWriterProfiles: vi.fn(async () => true) };
});
vi.mock("@/lib/data/server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  return { getServiceRepos: () => actual.createInMemoryRepos(data) };
});
vi.mock("@/lib/data/repos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data/repos")>();
  return { ...actual, createRepos: () => actual.createInMemoryRepos(data) };
});
vi.mock("@/lib/analytics/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics/server")>();
  return {
    ...actual,
    withAction: async (action: string, run: () => Promise<unknown>, classify: (r: unknown) => unknown = actual.actionOutcome) => {
      const result = await run();
      recorded.push({ action, outcome: classify(result) });
      return result;
    },
  };
});

import { answerMilestone, setMilestonePhotoAlt, setMilestoneShare, takeBackMilestone } from "@/app/(member)/settings/milestoneActions";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";

const identity = (memberId: string, isSudo = false) => ({ memberId, memberName: "x", memberEmail: "x@example.com", isSudo });
const repo = () => createInMemoryRepos(data).milestones;
const mine = async () => (await repo().ofMember(ADA))[0];

let milestoneId = "";
let bookId = "";

beforeEach(async () => {
  data = new InMemoryDataset({ members: [{ id: ADA, name: "Ada Example" }, { id: BO, name: "Bo Example" }] });
  data.memberBooks.push({ id: "book_AAAAAAAAAAA1", member_id: ADA, title: "A Fake Book", published_date: "2026-01-01", cover_asset_id: null });
  bookId = "book_AAAAAAAAAAA1";
  recorded.length = 0;
  removedFiles.length = 0;
  vi.mocked(getCurrentUser).mockResolvedValue({ id: USER, email: "ada@example.com" });
  vi.mocked(getEffectiveIdentity).mockResolvedValue(identity(ADA));
  const answer = { status: "confirmed" as const, achievedOn: null, achievedPrecision: "day" as const, storyBefore: null, storyAfter: null, consent_testimonial: false };
  milestoneId = (await repo().addOwn({ memberId: ADA, kind: "the_end", answer, work: { projectId: null, bookId: null, title: "A Fake Novel" }, createdBy: USER }, NOW)).milestone.id;
  await repo().setPhoto(milestoneId, ADA, PATH, "Desk", NOW);
  await repo().setBookPhoto(bookId, ADA, `${ADA}/${"b".repeat(32)}.webp`, "Book", NOW);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("setMilestonePhotoAlt", () => {
  it("describes the member's own photo, on a milestone and on a book, trimming it, and clears it when empty", async () => {
    expect(await setMilestonePhotoAlt("milestone", milestoneId, "  At my   desk ")).toEqual({ success: true });
    expect((await mine()).photo?.alt).toBe("At my desk");
    expect(await setMilestonePhotoAlt("book", bookId, "Holding it")).toEqual({ success: true });
    expect((await repo().bookPhotosOf(ADA))[0].alt).toBe("Holding it");
    expect(await setMilestonePhotoAlt("milestone", milestoneId, "   ")).toEqual({ success: true });
    expect((await mine()).photo?.alt).toBeNull();
    expect(recorded.map((r) => r.action)).toEqual(["milestone_photo_alt_set", "milestone_photo_alt_set", "milestone_photo_alt_set"]);
  });

  it("refuses one that is too long, for staff viewing as the member (sudo), when signed out, and for another member's photo or a missing one", async () => {
    expect(await setMilestonePhotoAlt("milestone", milestoneId, "x".repeat(MILESTONE_PHOTO.altMaxLength + 1))).toHaveProperty("error");
    vi.mocked(getEffectiveIdentity).mockResolvedValue(identity(ADA, true));
    expect(await setMilestonePhotoAlt("milestone", milestoneId, "Sudo")).toEqual({ error: "Only you can change this." });
    vi.mocked(getEffectiveIdentity).mockResolvedValue(identity(BO));
    expect(await setMilestonePhotoAlt("milestone", milestoneId, "Not mine")).toHaveProperty("error");
    expect(await setMilestonePhotoAlt("book", bookId, "Not mine")).toHaveProperty("error");
    vi.mocked(getEffectiveIdentity).mockResolvedValue(identity(ADA));
    expect(await setMilestonePhotoAlt("milestone", "mlst_ZZZZZZZZZZZZ", "Missing")).toHaveProperty("error");
    expect(await setMilestonePhotoAlt("milestone", "", "No id")).toHaveProperty("error");
    expect(await setMilestonePhotoAlt("elsewhere" as never, milestoneId, "Bad target")).toHaveProperty("error");
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);
    expect(await setMilestonePhotoAlt("milestone", milestoneId, "No record")).toHaveProperty("error");
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect(await setMilestonePhotoAlt("milestone", milestoneId, "Signed out")).toEqual({ error: "Please sign in again." });
    expect((await mine()).photo?.alt).toBe("Desk");
  });

  it("says there is no photo to describe once it is gone", async () => {
    await repo().removePhoto(milestoneId, ADA, NOW);
    expect(await setMilestonePhotoAlt("milestone", milestoneId, "Gone")).toEqual({ error: "We couldn't find that photo. It may have been taken away." });
  });

  it("reports a database failure without the details", async () => {
    vi.spyOn(repo().constructor.prototype, "setPhotoAlt").mockRejectedValueOnce(new Error("database down"));
    const result = await setMilestonePhotoAlt("milestone", milestoneId, "Oops");
    expect(result).toEqual({ error: "We couldn't save that. Please try again in a moment." });
  });
});

describe("a milestone that stops being the member's claim takes its photo with it", () => {
  it("deletes the photo and its file when the member takes the milestone back", async () => {
    expect(await takeBackMilestone(milestoneId)).toEqual({ success: true });
    expect(removedFiles).toEqual([PATH]);
    expect(data.memberMilestones.find((m) => m.id === milestoneId)).toMatchObject({ photo_path: null, photo_alt: null });
  });

  it("deletes the photo and its file when the member says it is not them", async () => {
    expect(await answerMilestone({ id: milestoneId, answer: "decline" })).toEqual({ success: true });
    expect(removedFiles).toEqual([PATH]);
    expect(data.memberMilestones.find((m) => m.id === milestoneId)?.photo_path).toBeNull();
  });

  it("keeps the photo when the member only changes their answer", async () => {
    expect(await answerMilestone({ id: milestoneId, answer: "confirm", storyAfter: "At last." })).toEqual({ success: true });
    expect(removedFiles).toEqual([]);
    expect((await mine()).photo?.token).toBe("a".repeat(32));
  });

  it("still takes the milestone back when the photo's file cannot be deleted", async () => {
    vi.spyOn(createInMemoryRepos(data).milestones.constructor.prototype, "removePhoto").mockRejectedValueOnce(new Error("storage down"));
    expect(await takeBackMilestone(milestoneId)).toEqual({ success: true });
    expect(data.memberMilestones.find((m) => m.id === milestoneId)?.deleted_at).not.toBeNull();
  });
});

describe("a photo is something to share, like a story", () => {
  it("keeps the share tick on a milestone with a photo and no story, and still drops it with neither", async () => {
    expect(await answerMilestone({ id: milestoneId, answer: "confirm", shareStory: true })).toEqual({ success: true });
    expect((await mine()).consentTestimonial).toBe(true);

    await repo().removePhoto(milestoneId, ADA, NOW);
    expect(await answerMilestone({ id: milestoneId, answer: "confirm", shareStory: true })).toEqual({ success: true });
    expect((await mine()).consentTestimonial).toBe(false);
  });

  it("never believes a form that says it has a photo", async () => {
    await repo().removePhoto(milestoneId, ADA, NOW);
    await answerMilestone({ id: milestoneId, answer: "confirm", shareStory: true, hasPhoto: true } as never);
    expect((await mine()).consentTestimonial).toBe(false);
  });

  it("lets the tick be set on a milestone with only a photo", async () => {
    expect(await setMilestoneShare(milestoneId, true)).toEqual({ success: true });
    expect((await mine()).consentTestimonial).toBe(true);
    await repo().removePhoto(milestoneId, ADA, NOW);
    expect(await setMilestoneShare(milestoneId, true)).toEqual({ error: "Write a story or add a photo first, and then you can share it." });
  });
});
