// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@puckeditor/core", () => ({ useGetPuck: () => () => undefined }));
vi.mock("../../src/app/(admin)/admin/pages/actions", () => ({ generateLandingBlocks: vi.fn(), reviseLandingBlocks: vi.fn() }));

import { AiPanelView, aiPlugin } from "@/app/(admin)/admin/pages/[slug]/AiPanel";

afterEach(cleanup);

const noop = { revise: vi.fn(), getContent: () => [], onReplace: vi.fn() };

async function submit(text: string, button = "Add to the page", label: RegExp = /What should I add/) {
  fireEvent.change(screen.getByLabelText(label), { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: button }));
  });
}

describe("the editor's AI tab", () => {
  it("is a left-rail plugin named AI", () => {
    expect(aiPlugin).toMatchObject({ name: "ai", label: "AI" });
  });

  it("sends the description, adds the blocks it gets back, and says what is left to fix", async () => {
    const blocks = [{ type: "Heading", props: { id: "h" } }, { type: "Button", props: { id: "b" } }];
    const generate = vi.fn().mockResolvedValue({ blocks, notes: [{ severity: "error", block: "Button", message: "A button needs a link." }] });
    const onAdd = vi.fn();
    render(<AiPanelView {...noop} generate={generate} onAdd={onAdd} />);
    await submit("a FAQ about the sprint");
    expect(generate).toHaveBeenCalledWith("a FAQ about the sprint");
    expect(onAdd).toHaveBeenCalledWith(blocks);
    expect(screen.getByRole("status")).toHaveTextContent("Added 2 blocks");
    expect(screen.getByRole("status")).toHaveTextContent("A button needs a link.");
  });

  it("says what the assistant did and lists each problem once", async () => {
    const note = { severity: "error" as const, block: "Button", message: "A button needs a link." };
    const revise = vi.fn().mockResolvedValue({ blocks: [{ type: "Heading", props: { id: "h" } }], notes: [note, note], summary: "Shortened the intro." });
    render(<AiPanelView {...noop} generate={vi.fn()} revise={revise} onAdd={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    await submit("shorter", "Change the page", /What should change/);
    expect(screen.getByRole("status")).toHaveTextContent("Shortened the intro.");
    expect(screen.getAllByText("A button needs a link.")).toHaveLength(1);
  });

  it("keeps the button off until something is typed", () => {
    render(<AiPanelView {...noop} generate={vi.fn()} onAdd={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Add to the page" })).toBeDisabled();
  });

  it("shows the reason and adds nothing when it fails", async () => {
    const onAdd = vi.fn();
    render(<AiPanelView {...noop} generate={vi.fn().mockResolvedValue({ error: "Build with AI isn't set up yet." })} onAdd={onAdd} />);
    await submit("anything");
    expect(screen.getByRole("alert")).toHaveTextContent("isn't set up");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("in Change mode sends the page's blocks with the description and replaces the page, not adds to it", async () => {
    const content = [{ type: "Heading", props: { id: "h" } }];
    const revised = [{ type: "Heading", props: { id: "h", text: "Shorter" } }];
    const revise = vi.fn().mockResolvedValue({ blocks: revised, notes: [] });
    const onAdd = vi.fn();
    const onReplace = vi.fn();
    const generate = vi.fn();
    render(<AiPanelView generate={generate} revise={revise} getContent={() => content} onAdd={onAdd} onReplace={onReplace} />);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    await submit("make the heading shorter", "Change the page", /What should change/);
    expect(revise).toHaveBeenCalledWith("make the heading shorter", content);
    expect(onReplace).toHaveBeenCalledWith(revised);
    expect(onAdd).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Changed the page");
  });

  it("in Change mode leaves the page alone when the assistant fails", async () => {
    const onReplace = vi.fn();
    render(<AiPanelView {...noop} revise={vi.fn().mockResolvedValue({ error: "The page is unchanged; try again." })} generate={vi.fn()} onAdd={vi.fn()} onReplace={onReplace} />);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    await submit("x", "Change the page", /What should change/);
    expect(screen.getByRole("alert")).toHaveTextContent("unchanged");
    expect(onReplace).not.toHaveBeenCalled();
  });
});
