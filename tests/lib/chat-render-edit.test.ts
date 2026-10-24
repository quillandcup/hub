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
