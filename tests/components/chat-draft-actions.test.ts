import { beforeEach, describe, expect, it, vi } from "vitest";
import { MEMBER_IDENTITY, MEMBER_USER, resetServerPageMocks, signInAs, useFakeSupabase } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({ service: true }) }));
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
