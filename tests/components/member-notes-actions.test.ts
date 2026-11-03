import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryAdminNoteRepository } from "@/lib/data/admin-notes";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

const admin = vi.hoisted(() => {
  const userId = "11111111-1111-4111-8111-111111111111";
  return { userId, result: { ok: true, user: { id: userId } } as { ok: true; user: { id: string } } | { ok: false; error: string } };
});
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/admin-auth", () => ({ requireAdminAction: async () => admin.result }));
vi.mock("@/lib/analytics/server", () => ({ withAction: async (_id: string, run: () => Promise<unknown>) => run() }));
let dataset: InMemoryDataset;
vi.mock("@/lib/data/server", () => ({
  getRepos: async () => ({ ...createInMemoryRepos(dataset), adminNotes: new InMemoryAdminNoteRepository(dataset, admin.userId) }),
}));

const { addMemberNote, editMemberNote, deleteMemberNote } = await import("@/app/(admin)/admin/members/[id]/notes-actions");

const MEMBER = "mbr_AAAAAAAAAAA1";
const notes = () => createInMemoryRepos(dataset).adminNotes.list(MEMBER);

beforeEach(() => {
  revalidatePath.mockClear();
  admin.userId = "11111111-1111-4111-8111-111111111111";
  admin.result = { ok: true, user: { id: admin.userId } };
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

describe("editMemberNote", () => {
  it("corrects the author's own recent note", async () => {
    await addMemberNote(MEMBER, "Sent an Instgram DM");
    const [note] = await notes();
    expect(await editMemberNote(MEMBER, note.id, " Sent an Instagram DM ")).toEqual({ success: true });
    expect(await notes()).toMatchObject([{ body: "Sent an Instagram DM", editedAt: expect.any(String) }]);
    expect(revalidatePath).toHaveBeenLastCalledWith(`/admin/members/${MEMBER}`, "layout");
  });

  it("says why when it is refused: someone else's note, or past the window", async () => {
    await addMemberNote(MEMBER, "mine");
    const [note] = await notes();
    admin.userId = "22222222-2222-4222-8222-222222222222";
    expect(await editMemberNote(MEMBER, note.id, "hijacked")).toEqual({ error: "Only the author can edit a note, and only in the first 15 minutes." });
    expect((await notes())[0].body).toBe("mine");
  });

  it("refuses non-admins, blank text, over-long text and a bad member id", async () => {
    admin.result = { ok: false, error: "Forbidden" };
    expect(await editMemberNote(MEMBER, "mnote_AAAAAAAAAAA1", "x")).toEqual({ error: "Forbidden" });
    admin.result = { ok: true, user: { id: admin.userId } };
    expect(await editMemberNote(MEMBER, "mnote_AAAAAAAAAAA1", "  ")).toEqual({ error: "Write something first." });
    expect(await editMemberNote(MEMBER, "mnote_AAAAAAAAAAA1", "x".repeat(5001))).toMatchObject({ error: expect.stringContaining("at most") });
    expect(await editMemberNote("nope", "mnote_AAAAAAAAAAA1", "x")).toEqual({ error: "Member not found." });
  });

  it("reports a failed save without leaking the database message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await addMemberNote(MEMBER, "mine");
    const [note] = await notes();
    const original = InMemoryAdminNoteRepository.prototype.edit;
    InMemoryAdminNoteRepository.prototype.edit = async () => {
      throw new Error("rpc exploded");
    };
    expect(await editMemberNote(MEMBER, note.id, "new")).toEqual({ error: "Couldn't save the change." });
    InMemoryAdminNoteRepository.prototype.edit = original;
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
