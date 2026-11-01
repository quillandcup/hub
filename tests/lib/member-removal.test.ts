import { beforeEach, describe, expect, it, vi } from "vitest";

const countLive = vi.fn(async () => 2);
vi.mock("@/lib/data/repos", () => ({ createRepos: () => ({ books: { countLive } }) }));

import { previewMemberRemoval, removeMemberOnRequest } from "@/lib/member-removal";

const rpc = vi.fn();
const deleteUser = vi.fn();
const remove = vi.fn();
const from = vi.fn(() => ({ remove }));
const db = { rpc, auth: { admin: { deleteUser } }, storage: { from } } as never;

const reportRow = (table: string, action: string, count: number) => ({ table_name: table, column_name: "member_id", action, why: "why", row_count: count });

beforeEach(() => {
  vi.clearAllMocks();
  deleteUser.mockResolvedValue({ error: null });
  remove.mockResolvedValue({ error: null });
});

describe("previewMemberRemoval", () => {
  it("lists only the choices that touch rows, deletes first, with the live books", async () => {
    rpc.mockResolvedValue({
      data: [reportRow("prickle_attendance", "repoint", 5), reportRow("writing_goals", "delete", 0), reportRow("writing_projects", "delete", 2), reportRow("member_books", "ask", 3)],
      error: null,
    });
    const preview = await previewMemberRemoval(db, "mbr_AAAAAAAAAAA1");
    expect(rpc).toHaveBeenCalledWith("member_data_report", { p_member_id: "mbr_AAAAAAAAAAA1" });
    expect(preview.rows.map((r) => `${r.action}:${r.table}:${r.count}`)).toEqual(["delete:writing_projects:2", "ask:member_books:3", "repoint:prickle_attendance:5"]);
    expect(preview.liveBooks).toBe(2);
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
    expect(from).not.toHaveBeenCalled();
  });

  it("says what did not finish once the database part has committed", async () => {
    rpc.mockResolvedValue({ data: removed, error: null });
    deleteUser.mockResolvedValue({ error: { message: "auth down" } });
    remove.mockResolvedValue({ error: { message: "storage down" } });
    const result = await removeMemberOnRequest(db, "mbr_AAAAAAAAAAA1", false);
    expect(result.ok && result.leftovers).toHaveLength(3);
    expect(result.ok && result.leftovers.join(" ")).toContain("auth down");
    expect(result.ok && result.leftovers.join(" ")).toContain("storage down");
  });
});
