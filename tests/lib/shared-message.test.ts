import { describe, it, expect } from "vitest";
import {
  MAX_SHARED_MESSAGES,
  MAX_SHARED_TEXT,
  httpsUrl,
  parseSharedMessage,
  parseSharedMessages,
  shareRemoveKey,
  sharedMessageSource,
} from "@/lib/chat/shared-message";

const share = (over: Record<string, unknown> = {}) => ({
  is_share: true,
  is_msg_unfurl: true,
  author_name: "Ada Example",
  author_subname: "ada",
  author_icon: "https://avatars.example.test/ada.png",
  text: "Tea &amp; <@U1> time",
  ts: "1700000000.000100",
  channel_id: "C123ABC",
  channel_name: "tea-room",
  from_url: "https://example.slack.com/archives/C123ABC/p1700000000000100",
  footer: "Slack Conversation",
  ...over,
});

describe("parseSharedMessage", () => {
  it("reads the fields of a share", () => {
    expect(parseSharedMessage(share())).toEqual({
      text: "Tea &amp; <@U1> time",
      authorName: "Ada Example",
      authorSubname: "ada",
      authorIcon: "https://avatars.example.test/ada.png",
      ts: "1700000000.000100",
      postedAt: "2023-11-14T22:13:20.000Z",
      slackChannelId: "C123ABC",
      channelName: "tea-room",
      slackUrl: "https://example.slack.com/archives/C123ABC/p1700000000000100",
      files: [],
    });
  });

  it("ignores attachments that are not shares, and non-objects", () => {
    for (const v of [null, undefined, 4, "x", [], { text: "link preview" }, { is_share: false, text: "x" }]) expect(parseSharedMessage(v)).toBeNull();
  });

  it("accepts is_msg_unfurl alone", () => {
    expect(parseSharedMessage({ is_msg_unfurl: true, text: "hi" })?.text).toBe("hi");
  });

  it("falls back to message_blocks, then fallback", () => {
    const blocks = [
      { message: { blocks: [{ type: "rich_text", elements: [{ type: "rich_text_section", elements: [{ type: "text", text: "Hello " }, { type: "user", user_id: "U9" }, { type: "emoji", name: "tea" }] }] }] } },
    ];
    expect(parseSharedMessage({ is_share: true, message_blocks: blocks })?.text).toBe("Hello <@U9>:tea:");
    expect(parseSharedMessage({ is_share: true, fallback: "plain fallback" })?.text).toBe("plain fallback");
  });

  it("is null with nothing to quote, and keeps a files-only share", () => {
    expect(parseSharedMessage({ is_share: true })).toBeNull();
    const s = parseSharedMessage({ is_share: true, files: [{ name: "pic.png", mimetype: "image/png" }, { nope: 1 }, "x"] });
    expect(s?.files).toEqual([{ name: "pic.png", mimetype: "image/png" }]);
  });

  it("defaults the author and drops a bad channel id and time", () => {
    const s = parseSharedMessage({ is_share: true, text: "x", ts: "not a ts", channel_id: "<script>" });
    expect(s).toMatchObject({ authorName: "Someone", authorSubname: null, postedAt: null, slackChannelId: null });
  });

  it("refuses non-https urls and non-Slack permalinks", () => {
    const s = parseSharedMessage(share({ author_icon: "javascript:alert(1)", from_url: "https://evil.example.test/x" }));
    expect(s?.authorIcon).toBeNull();
    expect(s?.slackUrl).toBeNull();
    expect(parseSharedMessage(share({ from_url: "javascript:alert(1)" }))?.slackUrl).toBeNull();
    expect(parseSharedMessage(share({ from_url: "http://example.slack.com/x" }))?.slackUrl).toBeNull();
    expect(httpsUrl("not a url")).toBeNull();
    expect(httpsUrl(5)).toBeNull();
  });

  it("caps the text and strips control characters", () => {
    const s = parseSharedMessage(share({ text: "a".repeat(MAX_SHARED_TEXT + 500), author_name: "Bo\u0000b" }));
    expect(s?.text.length).toBe(MAX_SHARED_TEXT);
    expect(s?.authorName).toBe("Bob");
  });

  it("does not read a share nested inside a share, or crash on deep hostile blocks", () => {
    const nested = share({ attachments: [share({ text: "inner", attachments: [share({ text: "innermost" })] })] });
    expect(parseSharedMessages([nested])).toHaveLength(1);
    let deep: unknown = { type: "text", text: "x" };
    for (let i = 0; i < 5000; i++) deep = { type: "rich_text_section", elements: [deep] };
    const s = parseSharedMessage({ is_share: true, text: "", message_blocks: [{ message: { blocks: [deep] } }], fallback: "fb" });
    expect(s?.text).toBe("fb");
  });
});

describe("parseSharedMessages", () => {
  it("keeps only shares, at most the cap", () => {
    const many = Array.from({ length: MAX_SHARED_MESSAGES + 4 }, () => share());
    expect(parseSharedMessages([{ title: "link" }, ...many])).toHaveLength(MAX_SHARED_MESSAGES);
    expect(parseSharedMessages("nope")).toEqual([]);
    expect(parseSharedMessages(null)).toEqual([]);
  });
});

describe("sharedMessageSource (never a gate)", () => {
  it("links the original when the viewer can read it", () => {
    expect(sharedMessageSource({ state: "readable", channelId: "hub-tea", messageId: "msg_AAAAAAAAAAA1", deleted: false })).toEqual({
      hubUrl: "/chat/hub-tea?m=msg_AAAAAAAAAAA1",
      deleted: false,
    });
  });

  it("notes a deleted original and gives no link", () => {
    expect(sharedMessageSource({ state: "readable", channelId: "c", messageId: "m", deleted: true })).toEqual({ hubUrl: null, deleted: true });
  });

  it("gives no link when the viewer can't read it, the Hub has no copy, or there was no lookup", () => {
    for (const l of [{ state: "hidden" as const }, { state: "not_mirrored" as const }, undefined]) {
      expect(sharedMessageSource(l)).toEqual({ hubUrl: null, deleted: false });
    }
  });

  it("refuses ids that could escape the path", () => {
    expect(sharedMessageSource({ state: "readable", channelId: "../x", messageId: "m", deleted: false })).toEqual({ hubUrl: null, deleted: false });
  });
});

describe("shareRemoveKey", () => {
  it("prefers the written link, then the permalink, and gives none without an https address or for a non-share", () => {
    expect(shareRemoveKey({ is_share: true, original_url: "https://a.example.test/x", from_url: "https://b.slack.com/archives/C1/p1" })).toBe("url:https://a.example.test/x");
    expect(shareRemoveKey({ is_msg_unfurl: true, from_url: "https://b.slack.com/archives/C1/p1" })).toBe("url:https://b.slack.com/archives/C1/p1");
    expect(shareRemoveKey({ is_share: true, from_url: "javascript:alert(1)" })).toBeNull();
    expect(shareRemoveKey({ is_share: true })).toBeNull();
    expect(shareRemoveKey({ title: "x", from_url: "https://b.slack.com/x" })).toBeNull();
  });
  it("shows no second author line when it repeats the name", () => {
    expect(parseSharedMessage({ is_share: true, text: "hi", author_name: "Ada  Example", author_subname: "ada example" })?.authorSubname).toBeNull();
  });
});
