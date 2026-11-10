import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/slack-capture", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/slack-capture")>()), ensureSlackFileCopied: vi.fn() }));

vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("@/lib/slack-connect", () => ({ getSlackUserToken: vi.fn() }));

import { InMemoryDataset } from "@/lib/data/in-memory";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getSlackUserToken } from "@/lib/slack-connect";
import { createInMemoryRepos } from "@/lib/data/repos";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { ensureSlackFileCopied } from "@/lib/slack-capture";
import { GET } from "@/app/api/chat/files/[messageId]/[fileId]/route";

const MESSAGE = "msg_AAAAAAAAAAA1";
const FILES = [
  { id: "F_IMG", name: "hedgie.gif", mimetype: "image/gif", size: 10 },
  { id: "F_HTML", name: "page.html", mimetype: "text/html", size: 10 },
];

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
let download: { data: Blob | null; error: { message: string } | null };
/** The bucket paths the route read, in order. */
let downloaded: string[] = [];
/** Bucket paths that are not there. */
let missing: string[] = [];

const call = (messageId: string, fileId: string) =>
  GET(new NextRequest("http://localhost/api/chat/files/x"), { params: Promise.resolve({ messageId, fileId }) });

beforeEach(() => {
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1", email: "member@example.com" });
  setContent(FILES);
  download = { data: new Blob(["bytes"]), error: null };
  downloaded = [];
  missing = [];
  vi.mocked(createClient).mockResolvedValue({} as never);
  vi.mocked(createServiceRoleClient).mockReturnValue({ storage: { from: () => ({ download: async (path: string) => (downloaded.push(path), missing.includes(path) ? { data: null, error: { message: "Object not found" } } : download) }) } } as never);
  vi.mocked(ensureSlackFileCopied).mockReset().mockResolvedValue({ ok: true, path: "F_IMG/hedgie.gif", mimetype: "image/gif" });
});

describe("GET /api/chat/files/[messageId]/[fileId]", () => {
  it("rejects signed-out callers and malformed ids", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await call(MESSAGE, "F_IMG")).status).toBe(401);
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1", email: "member@example.com" });
    expect((await call("not-a-uuid", "F_IMG")).status).toBe(404);
  });

  it("serves an image inline with the right type", async () => {
    const res = await call(MESSAGE, "F_IMG");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/gif");
    expect(res.headers.get("content-disposition")).toContain("inline");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toContain("private");
    expect(await res.text()).toBe("bytes");
    expect(ensureSlackFileCopied).toHaveBeenCalledWith(expect.anything(), expect.anything(), { fileId: "F_IMG", channelId: "C1", messageTs: "1.1" });
  });

  it("sends anything else as a download, never as a page", async () => {
    const res = await call(MESSAGE, "F_HTML");
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toContain("attachment");
  });

  it("serves a file still being sent from where the composer staged it, without asking Slack", async () => {
    setContent([{ id: "pending-1", name: "new.png", mimetype: "image/png", staged: "staging/2026-10-22/x/new.png" }], { ts: null, channel: "C1" });
    const res = await call(MESSAGE, "pending-1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(ensureSlackFileCopied).not.toHaveBeenCalled();

    setContent([{ id: "pending-1", name: "new.png", mimetype: "image/png" }], null);
    expect((await call(MESSAGE, "pending-1")).status).toBe(404);
  });

  describe("a file the Hub sent itself (its entry keeps the staged bytes)", () => {
    const staged = "staging/2026-11-04/m-1/shot.png";
    const sent = () => setContent([{ id: "F_NEW", name: "shot.png", mimetype: "image/png", staged }]);

    it("is served from the bytes the Hub sent, and Slack is never asked for it", async () => {
      sent();
      const res = await call(MESSAGE, "F_NEW");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(downloaded).toEqual([staged]);
      expect(ensureSlackFileCopied).not.toHaveBeenCalled();
    });

    it("is served from our permanent copy once there is one, still without asking Slack", async () => {
      sent();
      await repos.slackMessages.replaceFile({
        file_id: "F_NEW",
        channel_id: "C1",
        message_ts: "1.1",
        name: "shot.png",
        mimetype: "image/png",
        size_bytes: 3,
        storage_path: "F_NEW/shot.png",
        copied_at: "2026-11-04T04:27:36.000Z",
        raw_payload: {},
      });
      expect((await call(MESSAGE, "F_NEW")).status).toBe(200);
      expect(downloaded).toEqual(["F_NEW/shot.png"]);
      expect(ensureSlackFileCopied).not.toHaveBeenCalled();
    });

    it("asks Slack only when the staged bytes have been cleared away, and says so when it can't help either", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      sent();
      missing = [staged];
      vi.mocked(ensureSlackFileCopied).mockResolvedValue({ ok: true, path: "F_NEW/shot.png", mimetype: "image/png" });
      expect((await call(MESSAGE, "F_NEW")).status).toBe(200);
      expect(downloaded).toEqual([staged, "F_NEW/shot.png"]);
      expect(ensureSlackFileCopied).toHaveBeenCalledTimes(1);

      vi.mocked(ensureSlackFileCopied).mockResolvedValue({ ok: false, reason: "file_not_found" });
      expect((await call(MESSAGE, "F_NEW")).status).toBe(404);
      log.mockRestore();
    });
  });

  it("answers 404 when the caller can't read the message (RLS returns nothing) or the file isn't on it", async () => {
    setContent(null);
    expect((await call(MESSAGE, "F_IMG")).status).toBe(404);
    setContent(FILES, null);
    expect((await call(MESSAGE, "F_OTHER")).status).toBe(404);
    expect(ensureSlackFileCopied).not.toHaveBeenCalled();
  });

  it("answers 404 and logs when the file list can't be read", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.chat, "fileContext").mockRejectedValue(new Error("boom"));
    expect((await call(MESSAGE, "F_IMG")).status).toBe(404);
    expect(log).toHaveBeenCalledWith(expect.any(String), MESSAGE, "boom");
    log.mockRestore();
  });

  it("answers 404 when the file can't be copied or is missing from the bucket", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(ensureSlackFileCopied).mockResolvedValue({ ok: false, reason: "skipped: larger than 20 MB" });
    expect((await call(MESSAGE, "F_IMG")).status).toBe(404);
    vi.mocked(ensureSlackFileCopied).mockResolvedValue({ ok: true, path: "F_IMG/hedgie.gif", mimetype: "image/gif" });
    download = { data: null, error: { message: "Object not found" } };
    expect((await call(MESSAGE, "F_IMG")).status).toBe(404);
    log.mockRestore();
  });

  describe("a file in a one-on-one DM", () => {
    // The bot can't be in a DM, so the member looking at it asks Slack with their own token.
    beforeEach(() => {
      setContent(FILES, { ts: "1.1", channel: "D1" });
      vi.mocked(getEffectiveIdentity).mockResolvedValue({ memberId: "mbr_AAAAAAAAAAF1", isSudo: false } as never);
      vi.mocked(getSlackUserToken).mockResolvedValue({ token: "xoxp-viewer", slackUserId: "UF" });
    });

    it("is fetched with the viewer's own token, not the bot's", async () => {
      const res = await call(MESSAGE, "F_IMG");
      expect(res.status).toBe(200);
      expect(getSlackUserToken).toHaveBeenCalledWith(expect.anything(), "mbr_AAAAAAAAAAF1");
      expect(ensureSlackFileCopied).toHaveBeenCalledWith(expect.anything(), "xoxp-viewer", { fileId: "F_IMG", channelId: "D1", messageTs: "1.1" });
    });

    it("never uses another member's connection when Slack won't give the file to the viewer", async () => {
      repos = createInMemoryRepos(
        new InMemoryDataset({
          chatChannels: [{ id: "chn_AAAAAAAAAAA1", slack_channel_id: "D1" }],
          chatMessages: [{ id: MESSAGE, channel_id: "chn_AAAAAAAAAAA1", slack_ts: "1.1" }],
          chatMessageContents: [{ message_id: MESSAGE, files: FILES as never }],
          chatChannelMembers: [{ channel_id: "chn_AAAAAAAAAAA1", member_id: "mbr_AAAAAAAAAAF1" }, { channel_id: "chn_AAAAAAAAAAA1", member_id: "mbr_AAAAAAAAAAF2" }],
        }),
      );
      vi.mocked(getSlackUserToken).mockImplementation((async (_s: unknown, memberId: string) => ({ token: memberId === "mbr_AAAAAAAAAAF1" ? "xoxp-viewer" : "xoxp-other", slackUserId: "U" })) as never);
      vi.mocked(ensureSlackFileCopied).mockResolvedValue({ ok: false, reason: "download failed with HTTP 403" });
      expect((await call(MESSAGE, "F_IMG")).status).toBe(404);
      expect(vi.mocked(ensureSlackFileCopied).mock.calls.map(([, token]) => token)).toEqual(["xoxp-viewer"]);
      expect(getSlackUserToken).not.toHaveBeenCalledWith(expect.anything(), "mbr_AAAAAAAAAAF2");
    });

    it("is not asked of Slack at all when the viewer has no working connection, or is viewing as someone else", async () => {
      vi.mocked(getSlackUserToken).mockResolvedValue(null);
      expect((await call(MESSAGE, "F_IMG")).status).toBe(404);
      vi.mocked(getSlackUserToken).mockResolvedValue({ token: "xoxp-viewer", slackUserId: "UF" });
      vi.mocked(getEffectiveIdentity).mockResolvedValue({ memberId: "mbr_AAAAAAAAAAF1", isSudo: true } as never);
      expect((await call(MESSAGE, "F_IMG")).status).toBe(404);
      vi.mocked(getEffectiveIdentity).mockResolvedValue(null);
      expect((await call(MESSAGE, "F_IMG")).status).toBe(404);
      expect(ensureSlackFileCopied).not.toHaveBeenCalled();
    });
  });
});
