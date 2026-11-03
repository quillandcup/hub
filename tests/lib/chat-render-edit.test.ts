import { describe, it, expect } from "vitest";
import { fromEditableText, toEditableText } from "@/lib/chat/render";

const names = { userNames: { U1: "Ania Ray", U2: "Sam Lee", U3: "Sam Lee" }, channelNames: { C1: "general" } };
const roundTrip = (body: string) => {
  const editable = toEditableText(body, names);
  return { shown: editable.text, back: fromEditableText(editable.text, editable.tokens) };
};

describe("toEditableText / fromEditableText", () => {
  it("shows mentions, channels and labelled links by name, and restores Slack's markup", () => {
    const body = "hi <@U1>, see <#C1|general> and <https://example.test/a?x=1&amp;y=2|the doc>";
    expect(roundTrip(body)).toEqual({ shown: "hi @Ania Ray, see #general and the doc", back: body });
  });

  it("decodes entities for editing and encodes them again", () => {
    expect(roundTrip("a &lt; b &amp;&amp; c &gt; d")).toEqual({ shown: "a < b && c > d", back: "a &lt; b &amp;&amp; c &gt; d" });
  });

  it("shows a bare link as its address, and special mentions and groups by name", () => {
    const body = "<!here> <!channel> <!subteam^S1|@hosts> <https://example.test/a>";
    expect(roundTrip(body)).toEqual({ shown: "@here @channel @hosts https://example.test/a", back: body });
  });

  it("falls back to the label Slack gave, then a placeholder, for someone or something unknown", () => {
    expect(toEditableText("<@U9|zed> <@U8> <#C9|ideas> <#C8>", names).text).toBe("@zed @someone #ideas #channel");
  });

  it("tells two people with the same name apart so each keeps its own markup", () => {
    const body = "<@U2> and <@U3>";
    const { shown, back } = roundTrip(body);
    expect(shown).toBe("@Sam Lee and @Sam Lee (2)");
    expect(back).toBe(body);
  });

  it("puts back the longer name first, and leaves markup it can't show as it is", () => {
    const { tokens } = toEditableText("<@U1> <@U1>", { ...names, userNames: { U1: "Sam" } });
    tokens.set("@Sam Lee", "<@U2>");
    expect(fromEditableText("@Sam Lee and @Sam", tokens)).toBe("<@U2> and <@U1>");
    expect(roundTrip("<fakeprotocol:x> text")).toEqual({ shown: "<fakeprotocol:x> text", back: "<fakeprotocol:x> text" });
  });

  it("escapes typed angle brackets and ampersands that are not a name", () => {
    const editable = toEditableText("hi <@U1>", names);
    expect(fromEditableText("hi @Ania Ray <b> & co", editable.tokens)).toBe("hi <@U1> &lt;b&gt; &amp; co");
  });
});

describe("plain (a message written in the Hub)", () => {
  const round = (body: string) => {
    const editable = toEditableText(body, names, { plain: true });
    return { shown: editable.text, back: fromEditableText(editable.text, editable.tokens, { plain: true }) };
  };

  it("names only people and channels, and leaves everything else exactly as written", () => {
    const body = "a < b && c &amp; d <@U1> <#C1> <!here> <https://x.test|link>";
    expect(round(body)).toEqual({ shown: "a < b && c &amp; d @Ania Ray #general <!here> <https://x.test|link>", back: body });
  });

  it("doesn't escape what is typed", () => {
    const editable = toEditableText("hi <@U1>", names, { plain: true });
    expect(fromEditableText("hi @Ania Ray: 1 < 2 & 3", editable.tokens, { plain: true })).toBe("hi <@U1>: 1 < 2 & 3");
  });
});

describe("repeated edits are stable", () => {
  const samples = [
    "> Test - can only send in slack",
    "a & b <c> d",
    "intro\n> quoted & <b>\nafter > not a quote",
    "• one\n• two & three",
    "1. first\n2. second",
    "`a < b` and ```\nx > y & z\n```",
    "&amp; stays &lt;literal&gt;",
  ];

  it("a Slack-written message (mrkdwn: entities, quote as &gt;) round-trips unchanged, twice", () => {
    for (const sample of samples) {
      // Slack's text for it: the characters escaped, a leading > left as the quote's &gt;.
      const slack = sample.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const once = toEditableText(slack, names);
      const saved = fromEditableText(once.text, once.tokens);
      const twice = toEditableText(saved, names);
      expect(twice.text).toBe(once.text);
      expect(fromEditableText(twice.text, twice.tokens)).toBe(saved);
      expect(once.text).toBe(sample);
    }
  });

  it("sends a quote as a quote, not as a literal escaped >", () => {
    expect(fromEditableText("> Test\nnot > quote & <b>", new Map())).toBe("> Test\nnot &gt; quote &amp; &lt;b&gt;");
  });

  it("a Hub message round-trips unchanged, and an entity-escaped quote line is shown as a quote", () => {
    for (const sample of samples) {
      const once = toEditableText(sample, names, { plain: true });
      expect(once.text).toBe(sample.replace(/^&gt;(?= |$)/gm, ">"));
      expect(fromEditableText(once.text, once.tokens, { plain: true })).toBe(once.text);
    }
    expect(toEditableText("&gt; Test - can only send in slack", names, { plain: true }).text).toBe("> Test - can only send in slack");
  });
});
