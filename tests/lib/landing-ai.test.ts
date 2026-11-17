import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_BLOCKS, cleanGeneratedBlocks, completeWithClaude, generateLandingPage, systemPrompt } from "@/lib/landing/ai";
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
    for (const type of ["Testimonials", "OptInForm", "Image", "Split", "Countdown", "Video", "CardGrid"]) expect(AI_BLOCKS).not.toContain(type);
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

  it("returns null when nothing usable is left", () => {
    expect(cleanGeneratedBlocks(null)).toBeNull();
    expect(cleanGeneratedBlocks({ blocks: "x" })).toBeNull();
    expect(cleanGeneratedBlocks({ blocks: [{ type: "Nope" }] })).toBeNull();
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
    expect(body).toMatchObject({ model: ANTHROPIC.landingPageModel, tool_choice: { type: "tool", name: "build_page" }, messages: [{ role: "user", content: "prompt" }] });
  });

  it("throws on an error status or a missing tool call", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    await expect(completeWithClaude("s", "p")).rejects.toThrow("500");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [] }), { status: 200 })));
    await expect(completeWithClaude("s", "p")).rejects.toThrow("no tool call");
  });
});
