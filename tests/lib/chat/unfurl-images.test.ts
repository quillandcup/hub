import { describe, expect, it } from "vitest";
import { parseUnfurls } from "@/lib/chat/unfurls";
import { proxyUnfurlImages, unfurlImageSrc, unfurlImageUrls, unfurlPictureKey } from "@/lib/chat/unfurl-images";

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

    expect(proxied.botIcon).toBe(unfurlImageSrc(MESSAGE, unfurlPictureKey(img("logo"))));
    expect(unfurlImageSrc(MESSAGE, "0123456789abcdef")).toBe(`/api/chat/unfurl-image?m=${MESSAGE}&k=0123456789abcdef`);
    expect(unfurlPictureKey(img("one"))).toMatch(/^[0-9a-f]{16}$/);
    const text = JSON.stringify(proxied.unfurls);
    // the quoted message's raw attachment travels untouched but is never drawn; everything that is drawn is ours
    expect(JSON.stringify(proxied.unfurls.map((u) => (u.kind === "share" ? { ...u, attachment: null } : u)))).not.toContain("img.example.test");
    // every picture is named by a hash of its own address: the same name the route computes from the original
    const keys = [...text.matchAll(/&k=([0-9a-f]{16})/g)].map((m) => m[1]);
    const expected = ["one", "one-thumb", "author", "two", "accessory", "ctx", "block"].map((n) => unfurlPictureKey(img(n)));
    expect(keys.sort()).toEqual(expected.sort());
    const share = proxied.unfurls.find((u) => u.kind === "share");
    expect(share && "shared" in share && share.shared?.authorIcon).toBe(unfurlImageSrc(MESSAGE, unfurlPictureKey(img("author"))));
  });

  it("names a picture the same whatever is listed before it (the app's logo arriving later must not move it)", () => {
    const { unfurls } = parseUnfurls({ attachments: [{ title: "One", image_url: img("one") }] }, { bot: false, body: "x" });
    const without = proxyUnfurlImages(MESSAGE, unfurls, null).unfurls;
    const withLogo = proxyUnfurlImages(MESSAGE, unfurls, img("logo")).unfurls;
    expect(withLogo).toEqual(without);
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
