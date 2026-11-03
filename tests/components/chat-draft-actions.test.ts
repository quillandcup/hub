import { beforeEach, describe, expect, it, vi } from "vitest";
import { MEMBER_IDENTITY, MEMBER_USER, resetServerPageMocks, signInAs, useFakeSupabase } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("next/server", () => ({ after: () => {} }));
const serviceStorage = vi.hoisted(() => ({ remove: async (_paths: string[]): Promise<{ error: { message: string } | null }> => ({ error: null }) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({ service: true, storage: { from: () => ({ remove: (paths: string[]) => serviceStorage.remove(paths) }) } }) }));
vi.mock("@/lib/chat/slack-post", () => ({ sendChatMessageToSlack: vi.fn() }));
vi.mock("@/lib/slack-connect", () => ({ getSlackConnectionStatus: async () => ({ connected: true }) }));
vi.mock("@/lib/features.server", () => ({ getUserFeaturePreviews: vi.fn(async () => []), effectiveMemberHasFeature: async () => true }));
let dataset: InMemoryDataset;
vi.mock("@/lib/data/repos", async (orig) => ({
  ...(await orig<typeof import("@/lib/data/repos")>()),
  createRepos: () => createInMemoryRepos(dataset),
}));

const { saveChatDraft, sendChatMessage } = await import("@/app/(member)/chat/actions");

const CHANNEL = "chn_AAAAAAAAAAA1";
const ROOT = "msg_AAAAAAAAAAA1";
const me = MEMBER_IDENTITY.memberId;
const drafts = () => createInMemoryRepos(dataset).chatDrafts.list(me);

beforeEach(() => {
  resetServerPageMocks();
  dataset = new InMemoryDataset();
  signInAs(MEMBER_USER, MEMBER_IDENTITY);
  useFakeSupabase({ "rpc:chat_post_message": () => ({ data: "msg_AAAAAAAAAAA9" }) });
});

describe("saveChatDraft", () => {
  it("stores the member's text for the conversation and for a thread, separately", async () => {
    await saveChatDraft(CHANNEL, null, "in the channel");
    await saveChatDraft(CHANNEL, ROOT, "in the thread");
    expect((await drafts()).map((d) => [d.threadRootId, d.body]).sort()).toEqual([[null, "in the channel"], [ROOT, "in the thread"]].sort());
  });

  it("removes the draft when the text is blank", async () => {
    await saveChatDraft(CHANNEL, null, "something");
    await saveChatDraft(CHANNEL, null, "   ");
    expect(await drafts()).toEqual([]);
  });

  it("does nothing for ids that are not ours, signed out, or in sudo", async () => {
    await saveChatDraft("nope", null, "x");
    await saveChatDraft(CHANNEL, "nope", "x");
    signInAs(null);
    await saveChatDraft(CHANNEL, null, "x");
    signInAs(MEMBER_USER, { ...MEMBER_IDENTITY, isSudo: true });
    await saveChatDraft(CHANNEL, null, "x");
    expect(await drafts()).toEqual([]);
  });

  it("says nothing when the database refuses", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    createInMemoryRepos(dataset).chatDrafts.save = async () => {
      throw new Error("denied");
    };
    vi.spyOn(await import("@/lib/data/chat-drafts").then((m) => m.InMemoryChatDraftRepository.prototype), "save").mockRejectedValue(new Error("denied"));
    await expect(saveChatDraft(CHANNEL, null, "x")).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith("chat draft save failed:", "denied");
    vi.restoreAllMocks();
  });
});

describe("sending clears the draft", () => {
  it("removes the draft for the place that was sent to, and only that one", async () => {
    await saveChatDraft(CHANNEL, null, "going out");
    await saveChatDraft(CHANNEL, ROOT, "stays");
    expect(await sendChatMessage(CHANNEL, "going out")).toMatchObject({ ok: true });
    expect((await drafts()).map((d) => d.body)).toEqual(["stays"]);
  });
});

describe("saveChatDraft with files", () => {
  const removed: string[][] = [];
  const own = (n: number) => `staging/2026-11-02/${me}-0000000${n}-0000-4000-8000-000000000000/f${n}.txt`;
  const file = (n: number) => ({ path: own(n), name: `f${n}.txt`, mimetype: "text/plain", size: 5 });

  beforeEach(() => {
    removed.length = 0;
    serviceStorage.remove = async (paths: string[]) => {
      removed.push(paths);
      return { error: null };
    };
  });

  it("keeps the member's own staged files with the draft, and drops any other path", async () => {
    await saveChatDraft(CHANNEL, null, "", [file(1), { ...file(2), path: "staging/2026-11-02/mbr_someoneElse-00000000-0000-4000-8000-000000000000/x.txt" }, { path: "../../etc", name: "x", mimetype: "x", size: 1 }]);
    expect(await drafts()).toMatchObject([{ body: "", files: [file(1)] }]);
  });

  it("removes the bytes of a file taken out of the draft, and keeps the others", async () => {
    await saveChatDraft(CHANNEL, null, "a", [file(1), file(2)]);
    await saveChatDraft(CHANNEL, null, "a", [file(2)]);
    expect(removed).toEqual([[own(1)]]);
    await saveChatDraft(CHANNEL, null, "", []);
    expect(removed).toEqual([[own(1)], [own(2)]]);
    expect(await drafts()).toEqual([]);
  });

  it("does not remove anything when sending clears the draft (the send reads the staged files)", async () => {
    await saveChatDraft(CHANNEL, null, "going out", [file(1)]);
    expect(await sendChatMessage(CHANNEL, "going out", undefined, [])).toMatchObject({ ok: true });
    expect(await drafts()).toEqual([]);
    expect(removed).toEqual([]);
  });

  it("logs a failed byte removal and still keeps the draft saved", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    serviceStorage.remove = async () => ({ error: { message: "storage down" } });
    await saveChatDraft(CHANNEL, null, "a", [file(1)]);
    await saveChatDraft(CHANNEL, null, "a", []);
    expect(error).toHaveBeenCalledWith("removing a draft's staged files failed:", "storage down");
    expect(await drafts()).toMatchObject([{ body: "a", files: [] }]);
    error.mockRestore();
  });
});
