import { beforeEach, describe, expect, it, vi } from "vitest";

const countLive = vi.fn(async () => 2);
const deleteUser = vi.fn();
vi.mock("@/lib/data/repos", () => ({ createRepos: () => ({ books: { countLive }, authUsers: { delete: deleteUser } }) }));

import { previewMemberRemoval, removeMemberOnRequest } from "@/lib/member-removal";

const rpc = vi.fn();
const remove = vi.fn();
const list = vi.fn();
const from = vi.fn(() => ({ remove, list }));
const db = { rpc, storage: { from } } as never;

const reportRow = (table: string, action: string, count: number) => ({ table_name: table, column_name: "member_id", action, why: "why", row_count: count });

beforeEach(() => {
  vi.clearAllMocks();
  deleteUser.mockResolvedValue(undefined);
  remove.mockResolvedValue({ error: null });
  list.mockResolvedValue({ data: [], error: null });
});

describe("previewMemberRemoval", () => {
  it("lists only the choices that touch rows, deletes first, with the live books", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "member_removal_extras"
        ? {
            data: [
              { item: "auth_user", action: "delete", row_count: 1, samples: [] },
              { item: "access_events", action: "delete", row_count: 0, samples: [] },
              { item: "hiatus_notes", action: "clear", row_count: 2, samples: ["Hiatus from 01 Mar 2026 (note)"] },
            ],
            error: null,
          }
        : {
            data: [reportRow("prickle_attendance", "repoint", 5), reportRow("writing_goals", "delete", 0), reportRow("writing_projects", "delete", 2), reportRow("member_books", "ask", 3)],
            error: null,
          },
    );
    const preview = await previewMemberRemoval(db, "mbr_AAAAAAAAAAA1");
    expect(rpc).toHaveBeenCalledWith("member_data_report", { p_member_id: "mbr_AAAAAAAAAAA1" });
    expect(preview.rows.map((r) => `${r.action}:${r.table}:${r.count}`)).toEqual(["delete:writing_projects:2", "ask:member_books:3", "repoint:prickle_attendance:5"]);
    expect(preview.liveBooks).toBe(2);
    expect(rpc).toHaveBeenCalledWith("member_removal_extras", { p_member_id: "mbr_AAAAAAAAAAA1" });
    expect(preview.extras).toEqual([
      { item: "auth_user", action: "delete", count: 1, samples: [] },
      { item: "hiatus_notes", action: "clear", count: 2, samples: ["Hiatus from 01 Mar 2026 (note)"] },
    ]);
  });

  it("throws the error of the extras too", async () => {
    rpc.mockImplementation(async (name: string) => (name === "member_removal_extras" ? { data: null, error: { message: "extras boom" } } : { data: [], error: null }));
    await expect(previewMemberRemoval(db, "mbr_AAAAAAAAAAA1")).rejects.toThrow("extras boom");
  });

  it("throws the database's error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(previewMemberRemoval(db, "mbr_AAAAAAAAAAA1")).rejects.toThrow("boom");
  });
});

describe("removeMemberOnRequest", () => {
  const removed = { auth_user_id: "00000000-0000-4000-a000-000000000001", media_paths: ["m/one.png"], feedback_paths: ["u/shot.png"] };

  it("runs the routine, then deletes the auth user and each bucket's files", async () => {
    rpc.mockResolvedValue({ data: removed, error: null });
    expect(await removeMemberOnRequest(db, "mbr_AAAAAAAAAAA1", true)).toEqual({ ok: true, leftovers: [] });
    expect(rpc).toHaveBeenCalledWith("remove_member_data", { p_member_id: "mbr_AAAAAAAAAAA1", p_keep_public: true });
    expect(deleteUser).toHaveBeenCalledWith(removed.auth_user_id);
    expect(from).toHaveBeenCalledWith("media");
    expect(from).toHaveBeenCalledWith("feedback-screenshots");
    expect(remove).toHaveBeenCalledWith(["m/one.png"]);
    expect(remove).toHaveBeenCalledWith(["u/shot.png"]);
  });

  it("changes nothing else and reports the error when the database part fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "already removed" } });
    expect(await removeMemberOnRequest(db, "mbr_AAAAAAAAAAA1", false)).toEqual({ ok: false, error: "already removed" });
    expect(deleteUser).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("skips what is not there: a member with no sign-in and no files", async () => {
    rpc.mockResolvedValue({ data: { auth_user_id: null, media_paths: [], feedback_paths: [] }, error: null });
    expect(await removeMemberOnRequest(db, "mbr_AAAAAAAAAAA1", false)).toEqual({ ok: true, leftovers: [] });
    expect(deleteUser).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledTimes(2);
    expect(from).toHaveBeenCalledWith("milestone-photos");
    expect(from).toHaveBeenCalledWith("quiz-answer-files");
  });

  it("deletes the files a member uploaded as quiz answers, from each folder under their own", async () => {
    rpc.mockResolvedValue({ data: { auth_user_id: null, media_paths: [], feedback_paths: [] }, error: null });
    list
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [{ name: "11111111-1111-1111-1111-111111111111" }], error: null })
      .mockResolvedValueOnce({ data: [{ name: "letter.pdf" }], error: null })
      .mockResolvedValue({ data: [], error: null });
    expect(await removeMemberOnRequest(db, "mbr_AAAAAAAAAAA1", false)).toEqual({ ok: true, leftovers: [] });
    expect(remove).toHaveBeenCalledWith(["mbr_AAAAAAAAAAA1/11111111-1111-1111-1111-111111111111/letter.pdf"]);
  });

  it("says so when the quiz answer files cannot be listed", async () => {
    rpc.mockResolvedValue({ data: { auth_user_id: null, media_paths: [], feedback_paths: [] }, error: null });
    list.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await removeMemberOnRequest(db, "mbr_AAAAAAAAAAA1", false);
    expect(result).toMatchObject({ ok: true });
    expect((result as { leftovers: string[] }).leftovers.join(" ")).toMatch(/quiz answer files could not be listed \(boom\)/);
  });

  it("deletes every photo on a milestone from the member's own folder of the private bucket", async () => {
    rpc.mockResolvedValue({ data: { auth_user_id: null, media_paths: [], feedback_paths: [] }, error: null });
    list.mockResolvedValueOnce({ data: [{ name: "aaa.webp" }, { name: "bbb.webp" }], error: null }).mockResolvedValue({ data: [], error: null });
    expect(await removeMemberOnRequest(db, "mbr_AAAAAAAAAAA1", false)).toEqual({ ok: true, leftovers: [] });
    expect(list).toHaveBeenCalledWith("mbr_AAAAAAAAAAA1", { limit: 100 });
    expect(remove).toHaveBeenCalledWith(["mbr_AAAAAAAAAAA1/aaa.webp", "mbr_AAAAAAAAAAA1/bbb.webp"]);
  });

  it("says so when the photo folder cannot be listed or cleared", async () => {
    rpc.mockResolvedValue({ data: { auth_user_id: null, media_paths: [], feedback_paths: [] }, error: null });
    list.mockResolvedValueOnce({ data: null, error: { message: "list down" } });
    const listFailed = await removeMemberOnRequest(db, "mbr_AAAAAAAAAAA1", false);
    expect(listFailed.ok && listFailed.leftovers.join(" ")).toContain("list down");

    list.mockResolvedValueOnce({ data: [{ name: "aaa.webp" }], error: null });
    remove.mockResolvedValueOnce({ error: { message: "remove down" } });
    const removeFailed = await removeMemberOnRequest(db, "mbr_AAAAAAAAAAA1", false);
    expect(removeFailed.ok && removeFailed.leftovers.join(" ")).toContain("remove down");
  });

  it("says what did not finish once the database part has committed", async () => {
    rpc.mockResolvedValue({ data: removed, error: null });
    deleteUser.mockRejectedValue(new Error("auth down"));
    remove.mockResolvedValue({ error: { message: "storage down" } });
    const result = await removeMemberOnRequest(db, "mbr_AAAAAAAAAAA1", false);
    expect(result.ok && result.leftovers).toHaveLength(3);
    expect(result.ok && result.leftovers.join(" ")).toContain("auth down");
    expect(result.ok && result.leftovers.join(" ")).toContain("storage down");
  });
});
