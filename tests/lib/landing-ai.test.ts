import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_BLOCKS, cleanGeneratedBlocks, cleanSummary, newIssues, completeWithClaude, generateLandingPage, pageForModel, reviseLandingPage, systemPrompt } from "@/lib/landing/ai";
import { PROMPT_MAX } from "@/lib/landing/ai-limits";
import { ANTHROPIC } from "@/lib/config";
import { BLOCK_DEFAULTS } from "@/components/landing/config";

type Node = { type: string; props: Record<string, unknown> };
const content = (data: unknown) => (data as { content: Node[] }).content;

afterEach(() => vi.unstubAllGlobals());

describe("cleanGeneratedBlocks", () => {
  it("keeps known blocks, gives each an id, and fills missing props from the defaults", () => {
    const data = cleanGeneratedBlocks({ blocks: [{ type: "Heading", props: { text: "Welcome", level: "h1" } }] });
    const [heading] = content(data);
    expect(heading.type).toBe("Heading");
    expect(heading.props).toMatchObject({ text: "Welcome", level: "h1", align: "center" });
    expect(String(heading.props.id)).toMatch(/^Heading-/);
  });

  it("drops blocks it must not offer, unknown blocks and unknown props", () => {
    const data = cleanGeneratedBlocks({
      blocks: [
        { type: "Testimonials", props: { items: [{ quote: "invented", name: "x", detail: "y" }] } },
        { type: "OptInForm", props: { kajabiFormId: "1" } },
        { type: "Script", props: {} },
        { type: "Heading", props: { text: "Hi", onClick: "evil()", imageAssetId: "med_x" } },
      ],
    });
    expect(content(data).map((b) => b.type)).toEqual(["Heading"]);
    expect(content(data)[0].props).not.toHaveProperty("onClick");
    expect(JSON.stringify(data)).not.toContain("med_x");
    for (const type of ["Testimonials", "OptInForm", "Image", "Split", "Countdown", "Video"]) expect(AI_BLOCKS).not.toContain(type);
  });

  it("replaces a value outside the options or of the wrong kind with the default", () => {
    const [block] = content(cleanGeneratedBlocks({ blocks: [{ type: "Button", props: { label: 5, color: "hotpink", shape: "rect", full: "yes" } }] }));
    expect(block.props).toMatchObject({ label: BLOCK_DEFAULTS.Button.label, color: "plum", shape: "rect", full: false });
  });

  it("cleans links and rich text like anything an admin types", () => {
    const [button, text] = content(
      cleanGeneratedBlocks({ blocks: [{ type: "Button", props: { label: "Go", href: "javascript:alert(1)" } }, { type: "RichText", props: { html: "<p>Hi</p><script>alert(1)</script><img src=x onerror=y>" } }] }),
    );
    expect(button.props.href).toBe("");
    expect(String(text.props.html)).toBe("<p>Hi</p>");
  });

  it("caps lists, keeps a section's children one level deep, and trims item shapes", () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ title: `Step ${i}`, text: "t", extra: "no" }));
    const data = cleanGeneratedBlocks({
      blocks: [
        { type: "Steps", props: { items } },
        { type: "Section", props: { background: "cream", content: [{ type: "Heading", props: { text: "In" } }, { type: "Section", props: { content: [{ type: "Heading", props: {} }] } }] } },
      ],
    });
    const [steps, section] = content(data);
    expect(steps.props.items as unknown[]).toHaveLength(12);
    expect((steps.props.items as Record<string, unknown>[])[0]).toEqual({ title: "Step 0", text: "t" });
    // The nested section keeps its own children list empty: sections do not nest.
    const kids = section.props.content as Node[];
    expect(kids.map((k) => k.type)).toEqual(["Heading", "Section"]);
    expect(kids[1].props.content).toEqual([]);
  });

  it("reads a section's blocks from props.content or from beside props", () => {
    const heading = { type: "Heading", props: { text: "Inside" } };
    const [inProps, beside] = content(cleanGeneratedBlocks({ blocks: [{ type: "Section", props: { content: [heading] } }, { type: "Section", props: {}, content: [heading] }] }));
    expect((inProps.props.content as Node[]).map((b) => b.type)).toEqual(["Heading"]);
    expect((beside.props.content as Node[]).map((b) => b.type)).toEqual(["Heading"]);
  });

  it("returns null when nothing usable is left", () => {
    expect(cleanGeneratedBlocks(null)).toBeNull();
    expect(cleanGeneratedBlocks({ blocks: "x" })).toBeNull();
    expect(cleanGeneratedBlocks({ blocks: [{ type: "Nope" }] })).toBeNull();
  });
});

describe("what the model is told", () => {
  it("asks for a whole page, for blocks to add without a hero or call to action, or for a change that touches only what is asked", () => {
    expect(systemPrompt("page")).toContain("start with a Hero");
    expect(systemPrompt("add")).toContain("no Hero, no CtaBanner, no h1");
    expect(systemPrompt("add")).not.toContain("start with a Hero");
    expect(systemPrompt("change")).toContain("leave everything else exactly as it is");
  });

  it("uses the add instructions when adding blocks", async () => {
    const complete = vi.fn().mockResolvedValue({ blocks: [{ type: "Heading", props: { text: "x" } }] });
    await generateLandingPage("a faq", complete, "add");
    expect(complete.mock.calls[0][0]).toBe(systemPrompt("add"));
  });
});

describe("generateLandingPage", () => {
  const ok = { blocks: [{ type: "Hero", props: { headline: "Write more", primary: { label: "Join", href: "" } } }] };

  it("sends only the description and the builder's own block list, and reports the checks", async () => {
    const complete = vi.fn().mockResolvedValue(ok);
    const result = await generateLandingPage("  A page for the spring sprint  ", complete);
    expect(complete).toHaveBeenCalledWith(systemPrompt(), "A page for the spring sprint");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.issues.some((i) => i.severity === "error")).toBe(true); // the empty button link, left for the admin
  });

  it("refuses an empty or over-long description without calling the model", async () => {
    const complete = vi.fn();
    expect((await generateLandingPage("   ", complete)).ok).toBe(false);
    expect((await generateLandingPage("x".repeat(PROMPT_MAX + 1), complete)).ok).toBe(false);
    expect(complete).not.toHaveBeenCalled();
  });

  it("answers calmly when the model call fails or returns nothing usable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await generateLandingPage("x", async () => {
      throw new Error("Claude API answered 529");
    });
    expect(failed).toMatchObject({ ok: false, error: expect.stringContaining("Nothing was created") });
    expect(await generateLandingPage("x", async () => ({ blocks: [] }))).toMatchObject({ ok: false });
  });
});

describe("completeWithClaude", () => {
  it("posts to the configured host with the key and returns the tool's input", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: "text" }, { type: "tool_use", input: { blocks: [] } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const key = ANTHROPIC.apiKey;
    (ANTHROPIC as { apiKey?: string }).apiKey = "test-key";
    try {
      expect(await completeWithClaude("sys", "prompt")).toEqual({ blocks: [] });
    } finally {
      (ANTHROPIC as { apiKey?: string }).apiKey = key;
    }
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${ANTHROPIC.apiUrl}/v1/messages`);
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key");
    expect(headers["User-Agent"]).toContain("HedgieHub");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: ANTHROPIC.landingPageModel, tool_choice: { type: "auto" }, output_config: { effort: "medium" }, thinking: { type: "adaptive" }, messages: [{ role: "user", content: "prompt" }] });
  });

  it("puts Anthropic's error type and message in the thrown error, and copes with a body that isn't JSON", async () => {
    const body = { error: { type: "invalid_request_error", message: "tool_choice: not supported for this model" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 400 })));
    await expect(completeWithClaude("s", "p")).rejects.toThrow("400: invalid_request_error: tool_choice: not supported for this model");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 })));
    await expect(completeWithClaude("s", "p")).rejects.toThrow(/^Claude API answered 502$/);
  });

  it("throws on an error status or a missing tool call", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    await expect(completeWithClaude("s", "p")).rejects.toThrow("500");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [] }), { status: 200 })));
    await expect(completeWithClaude("s", "p")).rejects.toThrow("no tool call");
  });
});

describe("cards", () => {
  it("offers cards with an icon and a description, and no sample price or button", () => {
    const data = cleanGeneratedBlocks({ blocks: [{ type: "CardGrid", props: { columns: "3", items: [{ icon: "🤝", title: "Community", description: "Kind company.", imageAssetId: "med_x", price: "$5" }, { title: "Education", description: "Craft." }] } }] });
    const [grid] = content(data);
    const items = grid.props.items as Record<string, unknown>[];
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ icon: "🤝", title: "Community", description: "Kind company." });
    expect(items[1]).toMatchObject({ price: "", buttonLabel: "", href: "" });
    expect(JSON.stringify(data)).not.toContain("med_x");
    expect(systemPrompt("add")).toContain("CardGrid");
  });

  it("keeps a card grid that has pictures exactly as it is, since the model never sees the pictures", () => {
    const current = [{ type: "CardGrid", props: { id: "cg", columns: "3", items: [{ imageAssetId: "med_pic", alt: "A desk", title: "Old", price: "$1", buttonLabel: "", href: "" }] } }];
    const data = cleanGeneratedBlocks({ blocks: [{ id: "cg", type: "CardGrid", props: { items: [{ title: "New" }] } }] }, current);
    expect(content(data)).toEqual([{ type: "CardGrid", props: current[0].props }]);
    expect(JSON.stringify(pageForModel(current))).toContain('"locked":true');
  });
});

describe("spacing and width", () => {
  const section = (props: Record<string, unknown>, kids: unknown[] = []) => ({ type: "Section", props: { ...props, content: kids } });

  it("offers a Section its spacing as numbers, and not hiding", () => {
    const prompt = systemPrompt();
    expect(prompt).toContain("paddingDesktop");
    expect(prompt).toContain("paddingMobile");
    expect(prompt).toContain("`span`");
    expect(prompt).not.toContain("hideOnMobile");
    const sectionLine = prompt.split("\n").find((l) => l.startsWith("- Section:"))!;
    expect(sectionLine).toContain('"paddingDesktop":{"top":48');
    expect(sectionLine).not.toContain("padding=");
  });

  it("keeps a Section's padding as clamped whole numbers, with the defaults for what it left out, and never lets it hide a section", () => {
    const [s] = content(cleanGeneratedBlocks({ blocks: [section({ paddingDesktop: { top: 120, bottom: 99999, left: "x" }, paddingMobile: "wide", hideOnDesktop: true, hideOnMobile: true })] }));
    expect(s.props.paddingDesktop).toEqual({ ...BLOCK_DEFAULTS.Section.paddingDesktop, top: 120, bottom: 320 });
    expect(s.props.paddingMobile).toEqual(BLOCK_DEFAULTS.Section.paddingMobile);
    expect(s.props).not.toHaveProperty("hideOnDesktop");
    expect(s.props).not.toHaveProperty("hideOnMobile");
    expect(s.props).not.toHaveProperty("padding");
  });

  it("lets a block inside a Section take columns, and drops a width that is not 1 to 12", () => {
    const [s] = content(
      cleanGeneratedBlocks({
        blocks: [section({}, [{ type: "Button", props: { label: "A", span: 6, spanMobile: 12 } }, { type: "Button", props: { label: "B", span: 0, spanMobile: "wide" } }, { type: "Heading", props: { text: "C", span: 7.4 } }])],
      }),
    );
    const [a, b, c] = s.props.content as Node[];
    expect(a.props).toMatchObject({ span: 6, spanMobile: 12 });
    expect(b.props).not.toHaveProperty("span");
    expect(b.props).not.toHaveProperty("spanMobile");
    expect(c.props.span).toBe(7);
  });

  it("does not give a top-level block a width, and keeps the widths of a block the model did not mention on a change", () => {
    const [top] = content(cleanGeneratedBlocks({ blocks: [{ type: "Heading", props: { text: "Top", span: 4 } }] }));
    expect(top.props).not.toHaveProperty("span");
    const current = [{ type: "Section", props: { id: "s1", content: [{ type: "Button", props: { id: "b1", label: "Go", href: "", span: 5, spanMobile: 8 } }] } }];
    const data = cleanGeneratedBlocks({ blocks: [{ id: "s1", type: "Section", props: { content: [{ id: "b1", type: "Button", props: { label: "Go now" } }] } }] }, current);
    const kid = (content(data)[0].props.content as Node[])[0];
    expect(kid.props).toMatchObject({ label: "Go now", span: 5, spanMobile: 8 });
    // The model sees the widths it may change.
    expect(JSON.stringify(pageForModel(current))).toContain('"span":5');
  });

  it("changes a width the model sets on a block that already has one", () => {
    const current = [{ type: "Section", props: { id: "s1", content: [{ type: "Button", props: { id: "b1", label: "Go", href: "", span: 5, spanMobile: 8 } }] } }];
    const data = cleanGeneratedBlocks({ blocks: [{ id: "s1", type: "Section", props: { content: [{ id: "b1", type: "Button", props: { span: 12, spanMobile: null } }] } }] }, current);
    const kid = (content(data)[0].props.content as Node[])[0];
    expect(kid.props.span).toBe(12);
    expect(kid.props).not.toHaveProperty("spanMobile");
  });
});

describe("what is reported back", () => {
  const issue = (message: string) => ({ severity: "error" as const, block: "Button", message });
  it("lists only the problems a change added, counting repeats", () => {
    const before = [issue("A button needs a link."), issue("A button needs a link.")];
    const after = [issue("A button needs a link."), issue("A button needs a link."), issue("A button needs a link."), issue("New problem.")];
    expect(newIssues(after, before).map((i) => i.message)).toEqual(["A button needs a link.", "New problem."]);
  });

  it("reads the model's summary as one short plain line, or nothing", () => {
    expect(cleanSummary({ summary: "  Shortened\nthe intro.  " })).toBe("Shortened the intro.");
    expect(cleanSummary({ summary: 5 })).toBeUndefined();
    expect(cleanSummary({ summary: "x".repeat(500) })?.length).toBe(300);
  });

  it("passes the summary through and does not blame a change for the page's old problems", async () => {
    const current = [{ type: "Button", props: { id: "b1", label: "Join us", href: "" } }];
    const complete = vi.fn().mockResolvedValue({ summary: "Made it shorter.", blocks: [{ id: "b1", type: "Button", props: { label: "Join us" } }] });
    const result = await reviseLandingPage("shorter", current, complete);
    expect(result).toMatchObject({ ok: true, summary: "Made it shorter.", issues: [] });
    const built = await generateLandingPage("a page", vi.fn().mockResolvedValue({ summary: "Built it.", blocks: [{ type: "Heading", props: { text: "Hi" } }] }));
    expect(built).toMatchObject({ ok: true, summary: "Built it." });
    const added = await generateLandingPage("a faq", vi.fn().mockResolvedValue({ blocks: [{ type: "Heading", props: { text: "Hi", level: "h2" } }] }), "add");
    expect(added.ok && added.issues.some((i) => i.block === "Page")).toBe(false);
  });
});

describe("revising a page", () => {
  const current = [
    { type: "Hero", props: { id: "hero1", headline: "Old headline", subhead: "Old line", imageAssetId: "med_secret1", primary: { label: "Join", href: "/join" }, background: "plum" } },
    { type: "Image", props: { id: "img1", imageAssetId: "med_secret2", alt: "A desk" } },
    { type: "Section", props: { id: "sec1", background: "cream", content: [{ type: "Heading", props: { id: "h1", text: "Inside", level: "h2", align: "left" } }] } },
  ];

  it("shows the model ids and settings but never a picture id, and marks blocks it cannot write as locked", () => {
    const view = JSON.stringify(pageForModel(current));
    expect(view).not.toContain("med_secret");
    expect(pageForModel(current)[1]).toEqual({ id: "img1", type: "Image", locked: true });
    expect(view).toContain("Old headline");
    expect(view).toContain("Inside");
  });

  it("changes only what the model sent: the picture, the link and the other settings stay", () => {
    const data = cleanGeneratedBlocks({ blocks: [{ id: "hero1", type: "Hero", props: { headline: "New headline" } }] }, current);
    const [hero] = content(data);
    expect(hero.props).toMatchObject({ id: "hero1", headline: "New headline", subhead: "Old line", imageAssetId: "med_secret1", background: "plum", primary: { label: "Join", href: "/join" } });
  });

  it("keeps a locked block exactly as it was, even if the model rewrites it, and drops one it leaves out", () => {
    const data = cleanGeneratedBlocks({ blocks: [{ id: "img1", type: "Image", props: { alt: "hacked", imageAssetId: "med_other" } }, { type: "Image", props: { alt: "new" } }] }, current);
    expect(content(data)).toEqual([{ type: "Image", props: current[1].props }]);
  });

  it("matches blocks inside a section by id, adds new ones, and treats an unknown id as new", () => {
    const data = cleanGeneratedBlocks(
      { blocks: [{ id: "sec1", type: "Section", props: { content: [{ id: "h1", type: "Heading", props: { text: "Changed" } }, { id: "nope", type: "Heading", props: { text: "Fresh" } }] } }] },
      current,
    );
    const kids = (content(data)[0].props.content as Node[]);
    expect(kids[0].props).toMatchObject({ id: "h1", text: "Changed", level: "h2", align: "left" });
    expect(kids[1].props.id).not.toBe("nope");
    expect(content(data)[0].props.background).toBe("cream");
  });

  it("sends the page and the request to the model and returns the revised blocks", async () => {
    const complete = vi.fn().mockResolvedValue({ blocks: [{ id: "hero1", type: "Hero", props: { headline: "Shorter" } }] });
    const result = await reviseLandingPage("shorter", current, complete);
    expect(complete.mock.calls[0][1]).toContain("Old headline");
    expect(complete.mock.calls[0][1]).not.toContain("med_secret");
    expect(result.ok).toBe(true);
  });

  it("refuses an empty request, an empty page and one that is too long, and leaves the page alone when the model fails", async () => {
    const complete = vi.fn();
    expect((await reviseLandingPage(" ", current, complete)).ok).toBe(false);
    expect((await reviseLandingPage("x", [], complete)).ok).toBe(false);
    const huge = [{ type: "RichText", props: { id: "r", html: "x".repeat(70_000) } }];
    expect(await reviseLandingPage("x", huge, complete)).toMatchObject({ ok: false, error: expect.stringContaining("too long") });
    expect(complete).not.toHaveBeenCalled();
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await reviseLandingPage("x", current, async () => { throw new Error("529"); })).toMatchObject({ ok: false, error: expect.stringContaining("unchanged") });
    expect(await reviseLandingPage("x", current, async () => ({ blocks: [] }))).toMatchObject({ ok: false });
  });
});
