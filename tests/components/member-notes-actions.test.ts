import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

const admin = vi.hoisted(() => ({ result: { ok: true, user: { id: "11111111-1111-4111-8111-111111111111" } } as { ok: true; user: { id: string } } | { ok: false; error: string } }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/admin-auth", () => ({ requireAdminAction: async () => admin.result }));
vi.mock("@/lib/analytics/server", () => ({ withAction: async (_id: string, run: () => Promise<unknown>) => run() }));
let dataset: InMemoryDataset;
vi.mock("@/lib/data/server", () => ({ getRepos: async () => createInMemoryRepos(dataset) }));

const { addMemberNote, deleteMemberNote } = await import("@/app/(admin)/admin/members/[id]/notes-actions");

const MEMBER = "mbr_AAAAAAAAAAA1";
const notes = () => createInMemoryRepos(dataset).adminNotes.list(MEMBER);

beforeEach(() => {
  revalidatePath.mockClear();
  admin.result = { ok: true, user: { id: "11111111-1111-4111-8111-111111111111" } };
  dataset = new InMemoryDataset({ members: [{ id: MEMBER, name: "Ada Example", email: "ada@example.test" }] });
});

describe("addMemberNote", () => {
  it("saves the note as the signed-in admin and refreshes the member's pages", async () => {
    expect(await addMemberNote(MEMBER, "  Sent an Instagram DM ")).toEqual({ success: true });
    expect(await notes()).toMatchObject([{ body: "Sent an Instagram DM", createdBy: "11111111-1111-4111-8111-111111111111" }]);
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/members/${MEMBER}`, "layout");
  });

  it("refuses someone who isn't an admin, and writes nothing", async () => {
    admin.result = { ok: false, error: "Forbidden" };
    expect(await addMemberNote(MEMBER, "hello")).toEqual({ error: "Forbidden" });
    expect(await notes()).toEqual([]);
  });

  it("refuses blank text, over-long text and a bad member id", async () => {
    expect(await addMemberNote(MEMBER, "  ")).toEqual({ error: "Write something first." });
    expect(await addMemberNote(MEMBER, "x".repeat(5001))).toMatchObject({ error: expect.stringContaining("at most") });
    expect(await addMemberNote("not-an-id", "hello")).toEqual({ error: "Member not found." });
    expect(await notes()).toEqual([]);
  });

  it("reports a failed save without leaking the database message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await addMemberNote("mbr_ZZZZZZZZZZZ9", "hello")).toEqual({ error: "Couldn't save the note." });
    spy.mockRestore();
  });
});

describe("deleteMemberNote", () => {
  it("removes the note from the list", async () => {
    await addMemberNote(MEMBER, "mistake");
    const [note] = await notes();
    expect(await deleteMemberNote(MEMBER, note.id)).toEqual({ success: true });
    expect(await notes()).toEqual([]);
  });

  it("says so when the note is already gone, and refuses non-admins", async () => {
    expect(await deleteMemberNote(MEMBER, "mnote_AAAAAAAAAAA1")).toEqual({ error: "That note is already gone." });
    admin.result = { ok: false, error: "Forbidden" };
    expect(await deleteMemberNote(MEMBER, "mnote_AAAAAAAAAAA1")).toEqual({ error: "Forbidden" });
  });
});
