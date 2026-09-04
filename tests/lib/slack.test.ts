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
  delete process.env.SLACK_NEW_BOOKS_CHANNEL_ID;
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

  it("no-ops rather than sending for real when test mode is on but SLACK_DEV_USER_ID is unset", async () => {
    process.env.VERCEL_ENV = "preview";
    const { sendSlackDM } = await importSlackModule();

    await sendSlackDM({ slackUserId: "U_REAL_MEMBER", text: "hello" });

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

  it("no-ops when SLACK_BOT_TOKEN is unset", async () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.SLACK_BOT_TOKEN;
    const { sendSlackDM } = await importSlackModule();

    await sendSlackDM({ slackUserId: "U_REAL_MEMBER", text: "hello" });

    expect(postMessage).not.toHaveBeenCalled();
  });
});

describe("notifyStaffNewBook", () => {
  it("no-ops when SLACK_NEW_BOOKS_CHANNEL_ID is unset", async () => {
    const { notifyStaffNewBook } = await importSlackModule();

    await notifyStaffNewBook({
      title: "My Book",
      memberId: "member-1",
      memberName: "Member One",
      purchaseUrl: "https://example.com/buy",
    });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("no-ops when SLACK_BOT_TOKEN is unset", async () => {
    delete process.env.SLACK_BOT_TOKEN;
    process.env.SLACK_NEW_BOOKS_CHANNEL_ID = "C_NEW_BOOKS";
    const { notifyStaffNewBook } = await importSlackModule();

    await notifyStaffNewBook({
      title: "My Book",
      memberId: "member-1",
      memberName: "Member One",
      purchaseUrl: "https://example.com/buy",
    });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("posts to the configured channel with title, member name, and links when both env vars are set", async () => {
    process.env.SLACK_NEW_BOOKS_CHANNEL_ID = "C_NEW_BOOKS";
    const { notifyStaffNewBook } = await importSlackModule();

    await notifyStaffNewBook({
      title: "My Book",
      memberId: "member-1",
      memberName: "Member One",
      purchaseUrl: "https://example.com/buy",
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    const call = postMessage.mock.calls[0][0];
    expect(call.channel).toBe("C_NEW_BOOKS");
    expect(call.text).toContain("My Book");
    expect(call.text).toContain("Member One");
    expect(call.text).toContain("https://example.com/buy");
    expect(call.text).toContain("/admin/members/member-1");
  });

  it("still links to the member when no purchase URL is available", async () => {
    process.env.SLACK_NEW_BOOKS_CHANNEL_ID = "C_NEW_BOOKS";
    const { notifyStaffNewBook } = await importSlackModule();

    await notifyStaffNewBook({
      title: "My Book",
      memberId: "member-1",
      memberName: "Member One",
      purchaseUrl: null,
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    const call = postMessage.mock.calls[0][0];
    expect(call.text).not.toContain("Where to buy");
    expect(call.text).toContain("/admin/members/member-1");
  });
});
