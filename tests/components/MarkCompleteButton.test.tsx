// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const setLessonComplete = vi.fn<(lessonId: string, complete: boolean) => Promise<{ error?: string }>>();
vi.mock("@/app/(member)/courses/actions", () => ({ setLessonComplete: (...a: [string, boolean]) => setLessonComplete(...a) }));

import MarkCompleteButton from "@/app/(member)/courses/MarkCompleteButton";

beforeEach(() => {
  setLessonComplete.mockReset();
  setLessonComplete.mockResolvedValue({});
});

describe("MarkCompleteButton", () => {
  it("marks a lesson complete straight away and tells the server", async () => {
    render(<MarkCompleteButton lessonId="l1" completed={false} readOnly={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Mark complete" }));

    expect(screen.getByRole("button", { name: "✓ Completed" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(setLessonComplete).toHaveBeenCalledWith("l1", true));
  });

  it("un-completes a completed lesson", async () => {
    render(<MarkCompleteButton lessonId="l1" completed readOnly={false} />);
    await userEvent.click(screen.getByRole("button", { name: "✓ Completed" }));

    expect(screen.getByRole("button", { name: "Mark complete" })).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(setLessonComplete).toHaveBeenCalledWith("l1", false));
  });

  it("puts the button back and shows the reason when the server refuses", async () => {
    setLessonComplete.mockResolvedValue({ error: "You don't have access to this course" });
    render(<MarkCompleteButton lessonId="l1" completed={false} readOnly={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Mark complete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You don't have access to this course");
    expect(screen.getByRole("button", { name: "Mark complete" })).toBeInTheDocument();
  });

  it("is disabled, with a reason, when read-only (sudo)", async () => {
    render(<MarkCompleteButton lessonId="l1" completed={false} readOnly />);
    const button = screen.getByRole("button", { name: "Mark complete" });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringMatching(/viewing as a member/));
    await userEvent.click(button);
    expect(setLessonComplete).not.toHaveBeenCalled();
  });
});
