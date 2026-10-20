// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const setLessonComplete = vi.fn<(lessonId: string, complete: boolean) => Promise<{ error?: string }>>();
vi.mock("@/app/(member)/courses/actions", () => ({ setLessonComplete: (...a: [string, boolean]) => setLessonComplete(...a) }));

import { LessonCompletionProvider } from "@/app/(member)/courses/LessonCompletion";
import MarkCompleteButton from "@/app/(member)/courses/MarkCompleteButton";

const ui = (over: { initiallyCompleted?: boolean; readOnlyReason?: string | null } = {}) => (
  <LessonCompletionProvider lessonId="l1" initiallyCompleted={over.initiallyCompleted ?? false} readOnlyReason={over.readOnlyReason ?? null}>
    <MarkCompleteButton />
  </LessonCompletionProvider>
);

beforeEach(() => {
  setLessonComplete.mockReset();
  setLessonComplete.mockResolvedValue({});
});

describe("MarkCompleteButton", () => {
  it("is a white outlined 'Mark as complete' until the lesson is done, and wide", () => {
    render(ui());
    const button = screen.getByRole("button", { name: "Mark as complete" });

    expect(button).toHaveClass("w-full", "px-6", "py-3", "bg-white", "border-plum-600");
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("turns into a filled 'Complete' in the Hub's color once pressed, and tells the server", async () => {
    render(ui());
    await userEvent.click(screen.getByRole("button", { name: "Mark as complete" }));

    const done = screen.getByRole("button", { name: "Complete" });
    expect(done).toHaveClass("bg-plum-600", "text-white");
    expect(done).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(setLessonComplete).toHaveBeenCalledWith("l1", true));
  });

  it("starts as 'Complete' for a lesson that's already done, and pressing it clears it", async () => {
    render(ui({ initiallyCompleted: true }));
    await userEvent.click(screen.getByRole("button", { name: "Complete" }));

    expect(screen.getByRole("button", { name: "Mark as complete" })).toBeInTheDocument();
    await waitFor(() => expect(setLessonComplete).toHaveBeenCalledWith("l1", false));
  });

  it("puts the button back and shows the reason when the server refuses", async () => {
    setLessonComplete.mockResolvedValue({ error: "You don't have access to this course" });
    render(ui());
    await userEvent.click(screen.getByRole("button", { name: "Mark as complete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You don't have access to this course");
    expect(screen.getByRole("button", { name: "Mark as complete" })).toBeInTheDocument();
  });

  it("is disabled, with the reason as its tooltip, when read-only (sudo, or a staff preview)", async () => {
    render(ui({ readOnlyReason: "Progress isn't tracked for lessons members can't open yet" }));
    const button = screen.getByRole("button", { name: "Mark as complete" });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Progress isn't tracked for lessons members can't open yet");
    await userEvent.click(button);
    expect(setLessonComplete).not.toHaveBeenCalled();
  });

  it("renders nothing outside a completion provider", () => {
    const { container } = render(<MarkCompleteButton />);
    expect(container).toBeEmptyDOMElement();
  });
});
