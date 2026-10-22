import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/slack-capture", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/slack-capture")>()), ensureSlackFileCopied: vi.fn() }));

import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { ensureSlackFileCopied } from "@/lib/slack-capture";
import { GET } from "@/app/api/chat/files/[messageId]/[fileId]/route";

const MESSAGE = "00000000-0000-4000-8000-000000000001";
const FILES = [
  { id: "F_IMG", name: "hedgie.gif", mimetype: "image/gif", size: 10 },
  { id: "F_HTML", name: "page.html", mimetype: "text/html", size: 10 },
];

let content: unknown;
let download: { data: Blob | null; error: { message: string } | null };

const call = (messageId: string, fileId: string) =>
  GET(new NextRequest("http://localhost/api/chat/files/x"), { params: Promise.resolve({ messageId, fileId }) });

beforeEach(() => {
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1", email: "member@example.com" });
  content = { files: FILES, chat_messages: { slack_ts: "1.1", chat_channels: { slack_channel_id: "C1" } } };
  download = { data: new Blob(["bytes"]), error: null };
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: content }) };
  vi.mocked(createClient).mockResolvedValue({ from: () => query } as never);
  vi.mocked(createServiceRoleClient).mockReturnValue({ storage: { from: () => ({ download: async () => download }) } } as never);
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

  it("answers 404 when the caller can't read the message (RLS returns nothing) or the file isn't on it", async () => {
    content = null;
    expect((await call(MESSAGE, "F_IMG")).status).toBe(404);
    content = { files: FILES, chat_messages: null };
    expect((await call(MESSAGE, "F_OTHER")).status).toBe(404);
    expect(ensureSlackFileCopied).not.toHaveBeenCalled();
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
});
