import { describe, it, expect, afterEach, vi } from "vitest";
import type { KnownBlock } from "@slack/types";
import {
  buildSlackSignInBlocks,
  SLACK_SEND_LINK_ACTION_ID,
  type SlackSignInResolution,
} from "@/lib/slack-sign-in";

/**
 * Block Kit limits Slack enforces at runtime (views.publish / chat.postMessage fail with
 * invalid_blocks), which the @slack/types shapes can't express. Checked for every variant the
 * sign-in builder produces, with worst-case-length inputs. Limits from
 * https://docs.slack.dev/reference/block-kit/blocks and .../block-elements/button-element.
 */
const LIMITS = {
  homeBlocks: 100,
  messageBlocks: 50,
  sectionText: 3000,
  contextElements: 10,
  actionsElements: 25,
  buttonText: 75,
  buttonUrl: 3000,
  buttonValue: 2000,
  actionId: 255,
};

const origin = "https://hub.quillandcup.com";
const issued = {
  url: `${origin}/auth/slack?token=${"x".repeat(43)}`,
  code: "ABCDE12345",
  expiresAt: new Date("2026-09-29T15:00:00Z"),
  ttlMinutes: 60,
};
const longEmail = `${"a".repeat(64)}@${"b".repeat(180)}.example.com`;

const variants: [string, SlackSignInResolution, typeof issued | null, boolean][] = [
  ["member, Home tab", { status: "ok", userId: "u", email: longEmail }, issued, true],
  ["member, /hub reply", { status: "ok", userId: "u", email: longEmail }, issued, false],
  ["admin", { status: "admin" }, null, true],
  ["opted-in admin", { status: "ok", userId: "u", email: longEmail, admin: true }, { ...issued, ttlMinutes: 10 }, true],
  ["no account", { status: "no_account" }, null, true],
];

function textLengths(block: KnownBlock): number[] {
  if (block.type === "section") return [block.text?.text.length ?? 0];
  if (block.type === "context") return block.elements.map((e) => ("text" in e ? e.text.length : 0));
  return [];
}

describe.each(variants)("Slack sign-in blocks: %s", (_name, resolution, issuedFor, withRefresh) => {
  const blocks = buildSlackSignInBlocks(resolution, issuedFor, origin, { withRefresh });

  it("fits Slack's block count limits", () => {
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.length).toBeLessThanOrEqual(Math.min(LIMITS.homeBlocks, LIMITS.messageBlocks));
  });

  it("keeps every text within its limit", () => {
    for (const block of blocks) {
      for (const length of textLengths(block)) expect(length).toBeLessThanOrEqual(LIMITS.sectionText);
      if (block.type === "context") expect(block.elements.length).toBeLessThanOrEqual(LIMITS.contextElements);
    }
  });

  it("keeps buttons within their limits, with unique action ids", () => {
    const actionIds: string[] = [];
    for (const block of blocks) {
      if (block.type !== "actions") continue;
      expect(block.elements.length).toBeLessThanOrEqual(LIMITS.actionsElements);
      for (const el of block.elements) {
        if (el.type !== "button") continue;
        expect(el.text.text.length).toBeLessThanOrEqual(LIMITS.buttonText);
        expect(el.action_id!.length).toBeLessThanOrEqual(LIMITS.actionId);
        if (el.url) {
          expect(el.url.length).toBeLessThanOrEqual(LIMITS.buttonUrl);
          expect(el.url.startsWith("https://")).toBe(true);
        }
        if (el.value) expect(el.value.length).toBeLessThanOrEqual(LIMITS.buttonValue);
        actionIds.push(el.action_id!);
      }
    }
    expect(new Set(actionIds).size).toBe(actionIds.length);
  });
});

describe("Slack sign-in blocks: send-link button deep link", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function sendLinkButton() {
    const blocks = buildSlackSignInBlocks({ status: "ok", userId: "u", email: "member@example.com" }, issued, origin, {
      withRefresh: true,
    });
    const actions = blocks.find((b) => b.type === "actions") as { elements: any[] };
    return actions.elements.find((e) => e.action_id === SLACK_SEND_LINK_ACTION_ID);
  }

  it("opens the app's Messages tab when the Slack team and app ids are configured", () => {
    vi.stubEnv("SLACK_TEAM_ID", "T123");
    vi.stubEnv("SLACK_APP_ID", "A456");
    expect(sendLinkButton().url).toBe("slack://app?team=T123&id=A456&tab=messages");
  });

  it("has no url when the Slack team or app id is missing", () => {
    vi.stubEnv("SLACK_TEAM_ID", "T123");
    vi.stubEnv("SLACK_APP_ID", "");
    expect(sendLinkButton()).not.toHaveProperty("url");
  });
});
