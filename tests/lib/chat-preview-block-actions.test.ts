import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ repos: null as unknown }));

vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => ({ id: "auth-1", email: "fern@example.test" }) }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: async () => ({ memberId: "member-fern", isSudo: false }) }));
vi.mock("@/lib/features.server", () => ({ getUserFeaturePreviews: vi.fn(async () => []), effectiveMemberHasFeature: async () => true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: vi.fn() }) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/data/repos", async () => ({ ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")), createRepos: () => m.repos }));
vi.mock("@/lib/analytics/server", () => ({ withAction: async (_name: string, run: () => Promise<unknown>) => run() }));
vi.mock("@/lib/slack-connect", () => ({ getSlackConnectionStatus: async () => ({ connected: true }) }));
vi.mock("@/lib/chat/delivery", () => ({ deliverChatMessage: vi.fn(async () => "sent") }));
vi.mock("@/modules/chat/slack/edit", () => ({ updateChatMessageInSlack: async () => ({ ok: true }), deleteChatMessageInSlack: vi.fn(), deleteChatFileInSlack: vi.fn() }));
vi.mock("@/lib/chat/load", () => ({}));
const removeSlackUnfurl = vi.hoisted(() => vi.fn());
vi.mock("@/modules/chat/slack/unfurl-removal", () => ({ removeSlackUnfurl }));
vi.mock("@/lib/chat/notifications", () => ({ notifyChatMessage: vi.fn(), resolveChatNotifications: vi.fn() }));

import { hideChatUnfurl, unblockChatPreviews } from "@/app/(member)/chat/actions";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";

const MESSAGE = "msg_AAAAAAAAAAD1";
const repos = () => m.repos as Repos;

beforeEach(() => {
  removeSlackUnfurl.mockReset().mockResolvedValue("not_needed");
  m.repos = createInMemoryRepos(new InMemoryDataset({ chatMessages: [{ id: MESSAGE, channel_id: "chn_AAAAAAAAAAC1", deleted_at: null }] }));
});

describe("hideChatUnfurl with a block", () => {
  const ADDRESS = "https://thumb.wikimedia.org/wikipedia/commons/a/ab/x.jpg";
  const KEY = `url:${ADDRESS}`;
  const blocks = () => repos().chatLinkPreviews.blocksOf("member-fern");

  it("removes the card and saves the rule worked out from the card's own address, as the author", async () => {
    await expect(hideChatUnfurl(MESSAGE, KEY, "path")).resolves.toEqual({ ok: true, slack: "not_needed", blocked: true });
    expect([...((await repos().chatLinkPreviews.hiddenKeys([MESSAGE])).get(MESSAGE) ?? [])]).toEqual([KEY]);
    expect(await blocks()).toEqual([{ scope: "path", host: "thumb.wikimedia.org", pathPrefix: "/wikipedia", url: null }]);
  });

  it("saves each scope, and blocking the same thing twice is fine", async () => {
    await hideChatUnfurl(MESSAGE, KEY, "site");
    await hideChatUnfurl(MESSAGE, KEY, "site");
    await hideChatUnfurl(MESSAGE, KEY, "link");
    expect(await blocks()).toEqual([
      { scope: "site", host: "thumb.wikimedia.org", pathPrefix: null, url: null },
      { scope: "link", host: "thumb.wikimedia.org", pathPrefix: null, url: ADDRESS },
    ]);
  });

  it("blocks nothing and removes nothing for a scope that does not exist, or one the card has no address for", async () => {
    await expect(hideChatUnfurl(MESSAGE, KEY, "everything" as never)).resolves.toEqual({ ok: false, error: "Something went wrong." });
    await expect(hideChatUnfurl(MESSAGE, "idx:1", "site")).resolves.toEqual({ ok: false, error: "That preview can't be blocked." });
    await expect(hideChatUnfurl(MESSAGE, "url:https://example.test/", "path")).resolves.toEqual({ ok: false, error: "That preview can't be blocked." });
    await expect(hideChatUnfurl(MESSAGE, "url:http://example.test/a", "site")).resolves.toEqual({ ok: false, error: "That preview can't be blocked." });
    expect((await repos().chatLinkPreviews.hiddenKeys([MESSAGE])).size).toBe(0);
    expect(await blocks()).toEqual([]);
  });

  it("saves no rule when the removal is refused, and says so", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    repos().chatLinkPreviews.hide = async () => {
      throw new Error("new row violates row-level security policy");
    };
    await expect(hideChatUnfurl(MESSAGE, KEY, "site")).resolves.toEqual({ ok: false, error: "That preview can't be removed, so nothing was blocked." });
    expect(await blocks()).toEqual([]);
    expect(removeSlackUnfurl).not.toHaveBeenCalled();
  });

  it("keeps the removal and says the rule was not saved when saving it fails, without the address in the log", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    repos().chatLinkPreviews.block = async () => {
      throw new Error("db down");
    };
    const result = await hideChatUnfurl(MESSAGE, KEY, "site");
    expect(result).toMatchObject({ ok: true, slack: "not_needed", blocked: false, blockError: expect.stringContaining("Removed, but we couldn't block") });
    expect([...((await repos().chatLinkPreviews.hiddenKeys([MESSAGE])).get(MESSAGE) ?? [])]).toEqual([KEY]);
    expect(JSON.stringify(error.mock.calls)).not.toContain("wikimedia");
  });
});

describe("unblockChatPreviews", () => {
  const site = { scope: "site", host: "example.test", pathPrefix: null, url: null } as const;

  it("lifts the caller's own rule and leaves the others", async () => {
    await repos().chatLinkPreviews.block("member-fern", site);
    await repos().chatLinkPreviews.block("member-fern", { scope: "path", host: "example.test", pathPrefix: "/blog", url: null });
    await repos().chatLinkPreviews.block("member-moss", site);

    await expect(unblockChatPreviews(site)).resolves.toEqual({ ok: true });

    expect(await repos().chatLinkPreviews.blocksOf("member-fern")).toEqual([{ scope: "path", host: "example.test", pathPrefix: "/blog", url: null }]);
    expect(await repos().chatLinkPreviews.blocksOf("member-moss")).toEqual([site]);
  });

  it("refuses a rule that is not well formed", async () => {
    for (const bad of [null, { ...site, scope: "all" }, { ...site, host: 4 }, { ...site, host: "x".repeat(300) }, { ...site, pathPrefix: 3 }, { ...site, url: "y".repeat(2100) }]) {
      await expect(unblockChatPreviews(bad as never)).resolves.toEqual({ ok: false, error: "Something went wrong." });
    }
  });

  it("says so when the database refuses, without the address in the log", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    repos().chatLinkPreviews.unblock = async () => {
      throw new Error("db down");
    };
    await expect(unblockChatPreviews({ ...site, host: "secret.example.test" })).resolves.toEqual({ ok: false, error: "That couldn't be changed. Try again." });
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret");
  });
});
