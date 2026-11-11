import { describe, expect, it } from "vitest";
import { parseUnfurls } from "@/lib/chat/unfurls";
import { proxyUnfurlImages, unfurlImageSrc, unfurlImageUrls } from "@/lib/chat/unfurl-images";

const MESSAGE = "msg_AAAAAAAAAAA1";
const img = (n: string) => `https://img.example.test/${n}.png`;

const attachments = [
  { title: "One", image_url: img("one"), thumb_url: img("one-thumb") },
  { is_msg_unfurl: true, author_name: "Ada Example", author_icon: img("author"), text: "quoted", channel_id: "C1", ts: "1700000000.000100" },
  { title: "Two", image_url: img("two") },
];
const blocks = [
  { type: "section", text: { type: "mrkdwn", text: "hi" }, accessory: { type: "image", image_url: img("accessory"), alt_text: "a" } },
  { type: "context", elements: [{ type: "image", image_url: img("ctx"), alt_text: "c" }, { type: "mrkdwn", text: "x" }] },
  { type: "image", image_url: img("block"), alt_text: "b" },
  { type: "divider" },
];

describe("unfurl pictures", () => {
  it("lists the logo first, then every picture in the order it is drawn", () => {
    const { unfurls } = parseUnfurls({ attachments, blocks }, { bot: true, body: "" });
    expect(unfurlImageUrls(unfurls, img("logo"))).toEqual([img("logo"), img("one"), img("one-thumb"), img("author"), img("two"), img("accessory"), img("ctx"), img("block")]);
    expect(unfurlImageUrls(unfurls, null)[0]).toBe(img("one"));
  });

  it("rewrites every one to the route with the position the route will list it at, and leaves the rest alone", () => {
    const { unfurls } = parseUnfurls({ attachments, blocks }, { bot: true, body: "" });
    const withShared = unfurls.map((u) => (u.kind === "share" ? { ...u, shared: { text: "quoted", authorName: "Ada Example", authorSubname: null, authorIcon: img("author"), ts: "1.1", postedAt: null, slackChannelId: "C1", channelName: null, slackUrl: null, footer: null, files: [] } } : u));
    const proxied = proxyUnfurlImages(MESSAGE, withShared as never, img("logo"));

    expect(proxied.botIcon).toBe(unfurlImageSrc(MESSAGE, 0));
    expect(unfurlImageSrc(MESSAGE, 3)).toBe(`/api/chat/unfurl-image?m=${MESSAGE}&i=3`);
    const text = JSON.stringify(proxied.unfurls);
    // the quoted message's raw attachment travels untouched but is never drawn; everything that is drawn is ours
    expect(JSON.stringify(proxied.unfurls.map((u) => (u.kind === "share" ? { ...u, attachment: null } : u)))).not.toContain("img.example.test");
    // the same positions the route computes from the original
    const positions = [...text.matchAll(/&i=(\d+)/g)].map((m) => Number(m[1]));
    expect(positions.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const share = proxied.unfurls.find((u) => u.kind === "share");
    expect(share && "shared" in share && share.shared?.authorIcon).toBe(unfurlImageSrc(MESSAGE, 3));
  });

  it("counts a quoted message's author picture even before the loader has looked the message up", () => {
    const { unfurls } = parseUnfurls({ attachments: [attachments[1]] }, { bot: false, body: "x" });
    expect(unfurlImageUrls(unfurls, null)).toEqual([img("author")]);
    expect(proxyUnfurlImages(MESSAGE, unfurls, null).unfurls).toEqual(unfurls);
  });

  it("has nothing to list for a message without pictures", () => {
    const { unfurls } = parseUnfurls({ attachments: [{ title: "No picture", text: "x" }] }, { bot: false, body: "x" });
    expect(unfurlImageUrls(unfurls, null)).toEqual([]);
    expect(proxyUnfurlImages(MESSAGE, unfurls, null)).toEqual({ botIcon: null, unfurls });
  });
});
