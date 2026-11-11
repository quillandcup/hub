import { describe, it, expect } from "vitest";
import { blocksAreCards, MAX_ATTACHMENTS, MAX_BLOCKS, parseUnfurls, safeImageUrl, safeLinkUrl, unfurlTexts, withoutLessonPreview, type BlocksUnfurl, type CardUnfurl } from "@/lib/chat/unfurls";

const person = { bot: false, body: "hello" };
const app = { bot: true, body: "Deployed" };

describe("safeLinkUrl / safeImageUrl", () => {
  it("accepts http(s) links and https pictures only", () => {
    expect(safeLinkUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeLinkUrl("http://example.com")).toBe("http://example.com/");
    expect(safeImageUrl("https://example.com/i.png")).toBe("https://example.com/i.png");
    expect(safeImageUrl("http://example.com/i.png")).toBeNull();
  });

  it.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>", "mailto:a@example.com", "//example.com", "https://exa mple.com", "https://example.com/\u0000", "vbscript:x", "", "ftp://example.com"])(
    "refuses %j",
    (url) => {
      expect(safeLinkUrl(url)).toBeNull();
      expect(safeImageUrl(url)).toBeNull();
    }
  );

  it("refuses non-strings and absurdly long addresses", () => {
    expect(safeLinkUrl(42)).toBeNull();
    expect(safeLinkUrl({ toString: () => "https://example.com" })).toBeNull();
    expect(safeLinkUrl(`https://example.com/${"a".repeat(3000)}`)).toBeNull();
  });
});

describe("parseUnfurls: legacy attachments", () => {
  const link = {
    title: "Fern &amp; Co &lt;3",
    title_link: "https://example.com/a",
    text: "A page about <https://example.com|things> &amp; stuff",
    service_name: "example.com",
    from_url: "https://example.com/a",
    image_url: "https://example.com/i.png",
    thumb_url: "https://example.com/t.png",
    color: "36A64F",
    footer: "Footer &amp; more",
    fields: [{ title: "Env", value: "prod", short: true }, { title: "Long", value: "x" }],
    fallback: "Fern & Co",
  };

  it("reads a link preview, decoding plain fields and keeping mrkdwn for the renderer", () => {
    const { unfurls, hideBody } = parseUnfurls({ attachments: [link] }, person);
    expect(hideBody).toBe(false);
    const card = unfurls[0] as CardUnfurl;
    expect(card).toMatchObject({
      kind: "card",
      title: "Fern & Co <3",
      titleLink: "https://example.com/a",
      text: "A page about <https://example.com|things> &amp; stuff",
      serviceName: "example.com",
      fromUrl: "https://example.com/a",
      imageUrl: "https://example.com/i.png",
      thumbUrl: "https://example.com/t.png",
      color: "#36a64f",
      footer: "Footer & more",
    });
    expect(card.fields).toEqual([{ title: "Env", value: "prod", short: true }, { title: "Long", value: "x", short: false }]);
  });

  it("drops unsafe addresses and colors but keeps the card", () => {
    const { unfurls } = parseUnfurls(
      { attachments: [{ title: "T", title_link: "javascript:alert(1)", image_url: "http://insecure.example/i.png", thumb_url: "data:image/png;base64,xx", from_url: "javascript:1", color: "red;background:url(x)" }] },
      person
    );
    expect(unfurls[0]).toMatchObject({ kind: "card", title: "T", titleLink: null, imageUrl: null, thumbUrl: null, fromUrl: null, color: null });
  });

  it("maps Slack's named colors", () => {
    const { unfurls } = parseUnfurls({ attachments: [{ text: "x", color: "danger" }] }, app);
    expect((unfurls[0] as CardUnfurl).color).toBe("#e01e5a");
  });

  it("skips an attachment with nothing to draw (only a fallback)", () => {
    expect(parseUnfurls({ attachments: [{ fallback: "just text" }, {}, null, "x", 3, []] }, person).unfurls).toEqual([]);
  });

  it("leaves shared messages for their own renderer, passed through as a share", () => {
    const share = { is_msg_unfurl: true, channel_id: "C1", ts: "1.2", text: "quoted" };
    const shared = { is_share: true, text: "forwarded" };
    const { unfurls } = parseUnfurls({ attachments: [share, shared, { title: "Next" }] }, person);
    expect(unfurls.map((u) => u.kind)).toEqual(["share", "share", "card"]);
    expect(unfurls[0]).toEqual({ kind: "share", attachment: share });
  });

  it("caps how many attachments, fields and how much text it takes", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ title: `T${i}`, text: "x".repeat(10000), fields: Array.from({ length: 50 }, () => ({ title: "a", value: "b" })) }));
    const { unfurls } = parseUnfurls({ attachments: many }, person);
    expect(unfurls).toHaveLength(MAX_ATTACHMENTS);
    const card = unfurls[0] as CardUnfurl;
    expect(card.text).toHaveLength(3000);
    expect(card.fields).toHaveLength(10);
  });

  it("tolerates anything that is not a list", () => {
    for (const attachments of [null, undefined, "x", 5, {}, { 0: { title: "x" } }]) {
      expect(parseUnfurls({ attachments }, person).unfurls).toEqual([]);
    }
  });
});

describe("blocksAreCards: when blocks are drawn instead of text", () => {
  const section = [{ type: "section", text: { type: "mrkdwn", text: "*hi*" } }];
  it("draws an app's blocks, or any blocks of a message with no text", () => {
    expect(blocksAreCards(section, app)).toBe(true);
    expect(blocksAreCards(section, { bot: false, body: "  " })).toBe(true);
  });
  it("never draws rich_text (the text already says it), and a person's message with text stays text", () => {
    expect(blocksAreCards([{ type: "rich_text", elements: [] }], app)).toBe(false);
    expect(blocksAreCards([...section, { type: "rich_text" }], app)).toBe(false);
    expect(blocksAreCards(section, person)).toBe(false);
  });
  it("is false for no blocks or not a list", () => {
    expect(blocksAreCards([], app)).toBe(false);
    expect(blocksAreCards(null, app)).toBe(false);
    expect(blocksAreCards({ type: "section" }, app)).toBe(false);
  });
});

describe("parseUnfurls: Block Kit", () => {
  const blocks = [
    { type: "header", text: { type: "plain_text", text: "Deploy <ready> & set" } },
    { type: "section", text: { type: "mrkdwn", text: "*main* is live &amp; healthy" }, fields: [{ type: "mrkdwn", text: "*Env*\nprod" }, { type: "plain_text", text: "2 min" }], accessory: { type: "image", image_url: "https://example.com/a.png", alt_text: "logo" } },
    { type: "section", text: { type: "mrkdwn", text: "Open it" }, accessory: { type: "button", text: { type: "plain_text", text: "Visit" }, url: "https://example.com/v" } },
    { type: "context", elements: [{ type: "image", image_url: "https://example.com/c.png", alt_text: "c" }, { type: "mrkdwn", text: "by <@U1>" }] },
    { type: "divider" },
    { type: "image", image_url: "https://example.com/big.png", alt_text: "chart", title: { type: "plain_text", text: "Chart" } },
    { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Logs" }, url: "https://example.com/logs" }, { type: "button", text: { type: "plain_text", text: "Approve" }, action_id: "a" }, { type: "static_select" }] },
  ];

  it("reads the supported subset, keeping plain text plain and mrkdwn escaped for the renderer", () => {
    const { unfurls, hideBody } = parseUnfurls({ blocks }, app);
    expect(hideBody).toBe(true);
    const u = unfurls[0] as BlocksUnfurl;
    expect(u.blocks.map((b) => b.type)).toEqual(["header", "section", "section", "context", "divider", "image", "actions"]);
    expect(u.blocks[0]).toEqual({ type: "header", text: "Deploy <ready> & set" });
    expect(u.blocks[1]).toMatchObject({ text: { text: "*main* is live &amp; healthy", mrkdwn: true }, image: { url: "https://example.com/a.png", alt: "logo" } });
    expect(u.blocks[2]).toMatchObject({ button: { label: "Visit", url: "https://example.com/v" } });
    // Only a button with an address is kept; one that just sends something back to the app, and menus, are dropped.
    expect(u.blocks[6]).toEqual({ type: "actions", buttons: [{ label: "Logs", url: "https://example.com/logs" }] });
  });

  it("offers one Open in Slack for blocks it cannot draw, and keeps the text when nothing else could be drawn", () => {
    const mixed = parseUnfurls({ blocks: [{ type: "header", text: { type: "plain_text", text: "H" } }, { type: "video" }, { type: "table" }] }, app);
    const mixedBlocks = (mixed.unfurls[0] as BlocksUnfurl).blocks;
    expect(mixedBlocks.map((b) => b.type)).toEqual(["header", "unsupported"]);
    expect(mixed.hideBody).toBe(true);

    const only = parseUnfurls({ blocks: [{ type: "input" }] }, app);
    expect((only.unfurls[0] as BlocksUnfurl).blocks).toEqual([{ type: "unsupported", blockType: "input" }]);
    expect(only.hideBody).toBe(false);

    const menuOnly = parseUnfurls({ blocks: [{ type: "actions", elements: [{ type: "static_select" }] }] }, app);
    expect((menuOnly.unfurls[0] as BlocksUnfurl).blocks[0]).toMatchObject({ type: "unsupported", blockType: "actions" });
  });

  it("refuses unsafe button and image addresses", () => {
    const { unfurls } = parseUnfurls(
      {
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: "x" }, accessory: { type: "button", text: { type: "plain_text", text: "Go" }, url: "javascript:alert(1)" } },
          { type: "image", image_url: "javascript:alert(1)", alt_text: "x" },
        ],
      },
      app
    );
    const b = (unfurls[0] as BlocksUnfurl).blocks;
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ type: "section", button: null, image: null });
  });

  it("does not draw a person's rich text message, and survives hostile blocks", () => {
    expect(parseUnfurls({ blocks: [{ type: "rich_text", elements: [] }] }, person).unfurls).toEqual([]);
    const hostile = [null, 3, "x", [], {}, { type: 5 }, { type: "section" }, { type: "section", fields: "no", text: 7 }, { type: "context", elements: "x" }, { type: "actions", elements: null }];
    expect(() => parseUnfurls({ blocks: hostile }, app)).not.toThrow();
  });

  it("reads only the first blocks of a huge message", () => {
    const huge = Array.from({ length: 500 }, () => ({ type: "divider" }));
    expect((parseUnfurls({ blocks: huge }, app).unfurls[0] as BlocksUnfurl).blocks).toHaveLength(MAX_BLOCKS);
  });
});

describe("unfurlTexts", () => {
  it("lists the mrkdwn of cards and blocks for mention, channel and emoji lookups, not plain text", () => {
    const { unfurls } = parseUnfurls(
      {
        attachments: [{ pretext: "pre <@U1>", text: "see <#C1|general>", fields: [{ title: "t", value: ":tada:" }] }],
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "hi <@U2>" }, fields: [{ type: "plain_text", text: "<@U3>" }] }, { type: "context", elements: [{ type: "mrkdwn", text: "by <@U4>" }] }],
      },
      app
    );
    expect(unfurlTexts(unfurls)).toEqual(["pre <@U1>", "see <#C1|general>", ":tada:", "hi <@U2>", "by <@U4>"]);
  });
});

describe("withoutLessonPreview", () => {
  const card = (over: Partial<CardUnfurl>): CardUnfurl => ({ kind: "card", color: null, authorName: null, authorLink: null, pretext: null, title: "t", titleLink: null, text: null, fields: [], imageUrl: null, thumbUrl: null, serviceName: null, fromUrl: null, footer: null, ...over });
  const LESSON = "les_AAAAAAAAAAA1";

  it("drops Slack's preview of the lesson the message shares, by its link or its original address", () => {
    const byTitle = card({ titleLink: `https://hub.example.test/courses/ready-writer/lessons/${LESSON}` });
    const byOrigin = card({ fromUrl: `https://hub.example.test/courses/ready-writer/lessons/${LESSON}?t=95` });
    expect(withoutLessonPreview([byTitle, byOrigin], LESSON)).toEqual([]);
  });

  it("keeps other previews, other lessons' previews, and everything when no lesson is shared", () => {
    const other = card({ titleLink: "https://example.org/article" });
    const otherLesson = card({ titleLink: "https://hub.example.test/courses/ready-writer/lessons/les_AAAAAAAAAAA2" });
    expect(withoutLessonPreview([other, otherLesson], LESSON)).toEqual([other, otherLesson]);
    const same = card({ titleLink: `https://hub.example.test/courses/ready-writer/lessons/${LESSON}` });
    expect(withoutLessonPreview([same], undefined)).toEqual([same]);
  });
});
