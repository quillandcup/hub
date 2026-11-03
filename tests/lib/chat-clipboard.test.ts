import { describe, it, expect } from "vitest";
import { messageToClipboard } from "@/lib/chat/clipboard";

const names = { userNames: { U1: "Ania Ray" }, channelNames: { C1: "general" } };

describe("messageToClipboard", () => {
  it("copies text a person can read: no <u>, no formatting markers, names for people and channels", () => {
    const { text } = messageToClipboard("can this <u>underline</u> too? *bold* _it_ <@U1> in <#C1|general> :pray:", names);
    expect(text).toBe("can this underline too? bold it @Ania Ray in #general 🙏");
  });

  it("copies HTML with the formatting, escaped, for pasting back as formatting", () => {
    const { html } = messageToClipboard("<u>under</u> *b* & <https://x.test|a link> `a<b`", names);
    expect(html).toBe('<p><u>under</u> <strong>b</strong> &amp; <a href="https://x.test">a link</a> <code>a&lt;b</code></p>');
  });

  it("keeps quotes, bullets and code blocks as lines and blocks", () => {
    const { text, html } = messageToClipboard("> said\n• one\n• two\n```\ncode\n```", names);
    expect(text).toBe("> said\n• one\n• two\ncode");
    expect(html).toBe("<blockquote>said</blockquote><ul><li>one</li><li>two</li></ul><pre><code>code</code></pre>");
  });
});
