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

  const nested = "1. <u>underline</u>\n  a. nested\n  b. *plain*\n  c. more\n    i. deep dark";

  it("copies a nested ordered list with its numbering and indentation as text", () => {
    expect(messageToClipboard(nested, names).text).toBe("1. underline\n  a. nested\n  b. plain\n  c. more\n    i. deep dark");
  });

  it("copies a nested ordered list as nested <ol> with the style of each level", () => {
    expect(messageToClipboard(nested, names).html).toBe(
      '<ol type="1"><li><u>underline</u><ol type="a"><li>nested</li><li><strong>plain</strong></li><li>more<ol type="i"><li>deep dark</li></ol></li></ol></li></ol>',
    );
  });

  it("nests a bullet list under a numbered item", () => {
    expect(messageToClipboard("1. one\n  • inner\n2. two", names).html).toBe('<ol type="1"><li>one<ul><li>inner</li></ul></li><li>two</li></ol>');
  });
});
