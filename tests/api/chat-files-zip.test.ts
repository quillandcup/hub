import { beforeEach, describe, expect, it, vi } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { apiFetch } from "../helpers/api-fetch";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/slack-capture", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/slack-capture")>()), ensureSlackFileCopied: vi.fn() }));

import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { ensureSlackFileCopied } from "@/lib/slack-capture";

const MESSAGE = "msg_AAAAAAAAAAA1";
const url = (id: string) => `/api/chat/files/${id}/zip`;

let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

/** The one message the route reads: its file list and, unless hidden, where it lives in Slack (null: RLS hides the message from the caller). */
const setContent = (files: unknown[] | null, slack: { ts: string | null; channel: string } | null = { ts: "1.1", channel: "C1" }) => {
  repos = createInMemoryRepos(
    new InMemoryDataset({
      chatChannels: slack ? [{ id: "chn_AAAAAAAAAAA1", slack_channel_id: slack.channel }] : [],
      chatMessages: slack ? [{ id: MESSAGE, channel_id: "chn_AAAAAAAAAAA1", slack_ts: slack.ts }] : [],
      chatMessageContents: files ? [{ message_id: MESSAGE, files: files as never }] : [],
    }),
  );
};
let bytes: Record<string, { data: Blob | { size: number; arrayBuffer: () => Promise<ArrayBuffer> } | null; error: { message: string } | null }>;

beforeEach(() => {
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1", email: "member@example.com" });
  setContent([
    { id: "F1", name: "a.txt", mimetype: "text/plain" },
    { id: "F2", name: "a.txt", mimetype: "text/plain" },
    { id: "F3", name: "gone.txt", mimetype: "text/plain" },
    { id: "F4", name: "nobytes.txt", mimetype: "text/plain" },
    { id: "pending-1", name: "new.txt", mimetype: "text/plain", staged: "staging/new.txt" },
    { id: "pending-2", name: "unstaged.txt", mimetype: "text/plain" },
  ]);
  bytes = {
    "F1/a.txt": { data: new Blob(["one"]), error: null },
    "F2/a.txt": { data: new Blob(["two"]), error: null },
    "F4/x": { data: null, error: { message: "nope" } },
    "staging/new.txt": { data: new Blob(["staged"]), error: null },
  };
  vi.mocked(createClient).mockResolvedValue({} as never);
  vi.mocked(createServiceRoleClient).mockReturnValue({ storage: { from: () => ({ download: async (p: string) => bytes[p] }) } } as never);
  vi.mocked(ensureSlackFileCopied).mockReset().mockImplementation((async (_s: unknown, _t: unknown, { fileId }: { fileId: string }) => {
    if (fileId === "F3") return { ok: false, reason: "deleted" };
    return { ok: true, path: fileId === "F4" ? "F4/x" : `${fileId}/a.txt`, mimetype: "text/plain" };
  }) as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/chat/files/[messageId]/zip", () => {
  it("rejects signed-out callers and malformed ids", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await apiFetch(url(MESSAGE))).status).toBe(401);
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1", email: "member@example.com" });
    expect((await apiFetch(url("not-a-uuid"))).status).toBe(404);
  });

  it("answers 404 when the caller can't read the message, it is missing, or it has no files", async () => {
    setContent(null);
    expect((await apiFetch(url(MESSAGE))).status).toBe(404);
    setContent([], null);
    expect((await apiFetch(url(MESSAGE))).status).toBe(404);
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("zips the readable files, renames collisions and leaves out deleted or missing ones", async () => {
    const res = await apiFetch(url(MESSAGE));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="attachments.zip"');
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(["a (2).txt", "a.txt", "new.txt"]);
    expect(strFromU8(files["a.txt"])).toBe("one");
    expect(strFromU8(files["a (2).txt"])).toBe("two");
    expect(strFromU8(files["new.txt"])).toBe("staged");
  });

  it("answers 404 and logs when the file list can't be read", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.chat, "fileContext").mockRejectedValue(new Error("boom"));
    expect((await apiFetch(url(MESSAGE))).status).toBe(404);
    expect(log).toHaveBeenCalledWith(expect.any(String), MESSAGE, "boom");
  });

  it("answers 404 when no file has bytes, and 413 past the size cap", async () => {
    setContent([{ id: "F3", name: "gone.txt" }], null);
    expect((await apiFetch(url(MESSAGE))).status).toBe(404);

    setContent([{ id: "F1", name: "a.txt" }], null);
    bytes["F1/a.txt"] = { data: { size: 101 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(0) }, error: null };
    expect((await apiFetch(url(MESSAGE))).status).toBe(413);
  });
});
