import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const postMessage = vi.fn().mockResolvedValue({});

vi.mock("@slack/web-api", () => ({
  WebClient: vi.fn().mockImplementation(function (this: any) {
    this.chat = { postMessage };
  }),
}));

const ORIGINAL_ENV = { ...process.env };

async function importSlackModule() {
  vi.resetModules();
  return import("@/lib/slack");
}

beforeEach(() => {
  postMessage.mockClear();
  process.env = { ...ORIGINAL_ENV };
  process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
  delete process.env.SLACK_TEST_MODE;
  delete process.env.SLACK_DEV_USER_ID;
  delete process.env.VERCEL_ENV;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("isSlackTestMode", () => {
  it("defaults on outside production when SLACK_TEST_MODE is unset", async () => {
    process.env.VERCEL_ENV = "preview";
    const { isSlackTestMode } = await importSlackModule();
    expect(isSlackTestMode()).toBe(true);
  });

  it("defaults off in production when SLACK_TEST_MODE is unset", async () => {
    process.env.VERCEL_ENV = "production";
    const { isSlackTestMode } = await importSlackModule();
    expect(isSlackTestMode()).toBe(false);
  });

  it("SLACK_TEST_MODE=true forces test mode on even in production", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.SLACK_TEST_MODE = "true";
    const { isSlackTestMode } = await importSlackModule();
    expect(isSlackTestMode()).toBe(true);
  });

  it("SLACK_TEST_MODE=false forces test mode off even outside production", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.SLACK_TEST_MODE = "false";
    const { isSlackTestMode } = await importSlackModule();
    expect(isSlackTestMode()).toBe(false);
  });
});

describe("sendSlackDM", () => {
  it("redirects to SLACK_DEV_USER_ID and prefixes the message when test mode is on", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.SLACK_DEV_USER_ID = "U_DEV";
    const { sendSlackDM } = await importSlackModule();

    await sendSlackDM({ slackUserId: "U_REAL_MEMBER", text: "hello" });

    expect(postMessage).toHaveBeenCalledTimes(1);
    const call = postMessage.mock.calls[0][0];
    expect(call.channel).toBe("U_DEV");
    expect(call.text).toContain("U_REAL_MEMBER");
    expect(call.text).toContain("hello");
  });

  it("reports a failure without sending when test mode is on but SLACK_DEV_USER_ID is unset", async () => {
    process.env.VERCEL_ENV = "preview";
    const { sendSlackDM } = await importSlackModule();

    await expect(sendSlackDM({ slackUserId: "U_REAL_MEMBER", text: "hello" })).rejects.toThrow("SLACK_DEV_USER_ID is unset");

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("sends directly to the real recipient, unprefixed, when test mode is off", async () => {
    process.env.VERCEL_ENV = "production";
    const { sendSlackDM } = await importSlackModule();

    await sendSlackDM({ slackUserId: "U_REAL_MEMBER", text: "hello" });

    expect(postMessage).toHaveBeenCalledTimes(1);
    const call = postMessage.mock.calls[0][0];
    expect(call.channel).toBe("U_REAL_MEMBER");
    expect(call.text).toBe("hello");
  });

  it("reports a failure when SLACK_BOT_TOKEN is unset", async () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.SLACK_BOT_TOKEN;
    const { sendSlackDM } = await importSlackModule();

    await expect(sendSlackDM({ slackUserId: "U_REAL_MEMBER", text: "hello" })).rejects.toThrow("SLACK_BOT_TOKEN not configured");

    expect(postMessage).not.toHaveBeenCalled();
  });
});

describe("celebrations", () => {
  beforeEach(() => {
    process.env.VERCEL_ENV = "production";
    process.env.SLACK_TEST_MODE = "false";
  });

  it("posts a new book to the celebrations channel with a public profile link", async () => {
    const { celebrateNewBook } = await importSlackModule();
    const { SLACK_CELEBRATIONS_CHANNEL_ID } = await import("@/lib/config");

    await celebrateNewBook({ title: "Q&A <beta>", memberId: "member-1", memberName: "Ada Example", purchaseUrl: "https://example.com/buy" });

    expect(postMessage).toHaveBeenCalledTimes(1);
    const call = postMessage.mock.calls[0][0];
    expect(call.channel).toBe(SLACK_CELEBRATIONS_CHANNEL_ID);
    expect(call.text).toContain("Q&amp;A &lt;beta&gt;");
    expect(call.text).toContain("Ada Example");
    expect(call.text).toContain("https://example.com/buy");
    expect(call.text).toContain("/members/member-1");
    expect(call.text).not.toContain("/admin/");
    expect(call.unfurl_links).toBe(false);
  });

  it("still links to the member when a book has no purchase URL", async () => {
    const { celebrateNewBook } = await importSlackModule();

    await celebrateNewBook({ title: "My Book", memberId: "member-1", memberName: "Ada Example", purchaseUrl: null });

    const call = postMessage.mock.calls[0][0];
    expect(call.text).not.toContain("Where to buy");
    expect(call.text).toContain("/members/member-1");
  });

  it("posts an award win with escaped names and a public profile link", async () => {
    const { celebrateNewAward } = await importSlackModule();
    const { SLACK_CELEBRATIONS_CHANNEL_ID } = await import("@/lib/config");

    await celebrateNewAward({ awardName: "Best <Poem>", workTitle: "Tom & Jerry", memberId: "member-1", memberName: "Ada Example", url: "https://example.com/win" });

    const call = postMessage.mock.calls[0][0];
    expect(call.channel).toBe(SLACK_CELEBRATIONS_CHANNEL_ID);
    expect(call.text).toContain("Best &lt;Poem&gt;");
    expect(call.text).toContain("Tom &amp; Jerry");
    expect(call.text).toContain("https://example.com/win");
    expect(call.text).toContain("/members/member-1");
  });

  it("uses a kind's override channel and falls back to the shared one", async () => {
    const { celebrationChannel, SLACK_CELEBRATIONS_CHANNEL_ID } = await import("@/lib/config");
    expect(celebrationChannel("book", { book: "C_BOOKS" })).toBe("C_BOOKS");
    expect(celebrationChannel("award", { book: "C_BOOKS" })).toBe(SLACK_CELEBRATIONS_CHANNEL_ID);
    expect(celebrationChannel("award", {})).toBe(SLACK_CELEBRATIONS_CHANNEL_ID);
  });

  it("posts nothing outside production", async () => {
    process.env.SLACK_TEST_MODE = "true";
    const { celebrateNewAward } = await importSlackModule();

    await celebrateNewAward({ awardName: "Best Poem", workTitle: "Work", memberId: "member-1", memberName: "Ada Example" });

    expect(postMessage).not.toHaveBeenCalled();
  });
});
