// @vitest-environment jsdom
/** The text editor of a Hub-owned lesson: what it loads, what Save sends, and what it shows when a save is refused. The action is faked. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const actions = vi.hoisted(() => ({ saveLessonText: vi.fn(), renameCourseItem: vi.fn(), setCourseItemStatus: vi.fn() }));
vi.mock("@/app/(admin)/admin/courses/outline-actions", () => actions);

import LessonTextEditor from "@/app/(admin)/admin/courses/[id]/lessons/[lessonId]/LessonTextEditor";

const COURSE = "crs_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";

// ProseMirror measures text with APIs jsdom doesn't have.
beforeEach(() => {
  vi.clearAllMocks();
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
  Range.prototype.getBoundingClientRect = () => rect;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
});

const field = () => screen.findByRole("textbox", { name: "Lesson text" });

describe("LessonTextEditor", () => {
  it("shows the lesson's text, with Save off until something changes", async () => {
    render(<LessonTextEditor courseId={COURSE} lessonId={LESSON} initialHtml="<h2>Welcome</h2><p>Hello Hedgies</p>" />);
    const editor = await field();
    expect(editor).toHaveTextContent("Welcome");
    expect(editor.querySelector("h2")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Save text" })).toBeDisabled();
  });

  it("sends the changed text as HTML for this lesson, then shows it saved and refreshes the page", async () => {
    actions.saveLessonText.mockResolvedValue({ id: LESSON });
    const user = userEvent.setup();
    render(<LessonTextEditor courseId={COURSE} lessonId={LESSON} initialHtml="<p>Hello</p>" />);
    await field();
    await user.click(screen.getByRole("button", { name: "Heading" }));
    await user.click(screen.getByRole("button", { name: "Save text" }));

    expect(actions.saveLessonText).toHaveBeenCalledTimes(1);
    expect(actions.saveLessonText.mock.calls[0].slice(0, 2)).toEqual([COURSE, LESSON]);
    expect(actions.saveLessonText.mock.calls[0][2]).toContain("<h2>Hello</h2>");
    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save text" })).toBeDisabled();
  });

  it("formats with the toolbar: a numbered list is sent as an ordered list", async () => {
    actions.saveLessonText.mockResolvedValue({ id: LESSON });
    const user = userEvent.setup();
    render(<LessonTextEditor courseId={COURSE} lessonId={LESSON} initialHtml="<p>First</p>" />);
    await field();
    await user.click(screen.getByRole("button", { name: "Numbered list" }));
    await user.click(screen.getByRole("button", { name: "Save text" }));
    expect(actions.saveLessonText.mock.calls[0][2]).toContain("<ol><li><p>First</p></li></ol>");
  });

  it("marks the selected text bold, italic, underlined and as a link with the toolbar, and removes the link again", async () => {
    actions.saveLessonText.mockResolvedValue({ id: LESSON });
    vi.spyOn(window, "prompt").mockReturnValue("https://example.com");
    const user = userEvent.setup();
    render(<LessonTextEditor courseId={COURSE} lessonId={LESSON} initialHtml="<p>Word</p>" />);
    await user.click(await field());
    await user.keyboard("{Control>}a{/Control}");
    for (const name of ["Bold", "Italic", "Underline", "Link"]) await user.click(screen.getByRole("button", { name }));
    expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Remove link" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Save text" }));
    const html = actions.saveLessonText.mock.calls[0][2] as string;
    expect(html).toContain("<strong>");
    expect(html).toContain("<em>");
    expect(html).toContain("<u>");
    expect(html).toContain('href="https://example.com"');

    await user.click(screen.getByRole("button", { name: "Remove link" }));
    await user.click(screen.getByRole("button", { name: "Save text" }));
    expect(actions.saveLessonText.mock.calls[1][2]).not.toContain("href=");
  });

  it("turns the selected text into a subheading, a bulleted list or a quote, and asks for no address when the link prompt is cancelled", async () => {
    actions.saveLessonText.mockResolvedValue({ id: LESSON });
    vi.spyOn(window, "prompt").mockReturnValue(null);
    const user = userEvent.setup();
    render(<LessonTextEditor courseId={COURSE} lessonId={LESSON} initialHtml="<p>One</p><p>Two</p><p>Three</p>" />);
    await user.click(await field());
    await user.keyboard("{Control>}a{/Control}");
    await user.click(screen.getByRole("button", { name: "Link" }));
    expect(screen.getByRole("button", { name: "Remove link" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Bulleted list" }));
    await user.click(screen.getByRole("button", { name: "Quote" }));
    await user.click(screen.getByRole("button", { name: "Save text" }));
    const html = actions.saveLessonText.mock.calls[0][2] as string;
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<ul>");
    expect(html).not.toContain("href=");

    // A subheading is made out of a plain paragraph, which the quoted list no longer is: take the quote and list off first.
    await user.click(screen.getByRole("button", { name: "Quote" }));
    await user.click(screen.getByRole("button", { name: "Bulleted list" }));
    await user.click(screen.getByRole("button", { name: "Subheading" }));
    await user.click(screen.getByRole("button", { name: "Save text" }));
    expect(actions.saveLessonText.mock.calls[1][2]).toContain("<h3>");
  });

  it("sends nothing but an empty text when everything is cleared", async () => {
    actions.saveLessonText.mockResolvedValue({ id: LESSON });
    const user = userEvent.setup();
    render(<LessonTextEditor courseId={COURSE} lessonId={LESSON} initialHtml="<p>Gone</p>" />);
    const editor = await field();
    await user.click(editor);
    await user.keyboard("{Control>}a{/Control}{Backspace}");
    await user.click(screen.getByRole("button", { name: "Save text" }));
    expect(actions.saveLessonText).toHaveBeenCalledWith(COURSE, LESSON, "");
  });

  it("shows why a save was refused and keeps Save available, without refreshing", async () => {
    actions.saveLessonText.mockResolvedValue({ error: "That text is too long." });
    const user = userEvent.setup();
    render(<LessonTextEditor courseId={COURSE} lessonId={LESSON} initialHtml="<p>Hi</p>" />);
    await field();
    await user.click(screen.getByRole("button", { name: "Heading" }));
    await user.click(screen.getByRole("button", { name: "Save text" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That text is too long.");
    expect(router.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save text" })).toBeEnabled();
  });

  it("tells the person when the action throws", async () => {
    actions.saveLessonText.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    render(<LessonTextEditor courseId={COURSE} lessonId={LESSON} initialHtml="<p>Hi</p>" />);
    await field();
    await user.click(screen.getByRole("button", { name: "Heading" }));
    await user.click(screen.getByRole("button", { name: "Save text" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong"));
  });
});
