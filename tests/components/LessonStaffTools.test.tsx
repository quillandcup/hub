// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const clearMyLessonProgress = vi.fn();
vi.mock("@/app/(member)/courses/actions", () => ({ clearMyLessonProgress: (...a: unknown[]) => clearMyLessonProgress(...a) }));

import LessonStaffTools from "@/app/(admin)/admin/courses/[id]/LessonStaffTools";

const PATH = "/courses/the-ready-writer/lessons/l1";
const tools = (over: Partial<React.ComponentProps<typeof LessonStaffTools>> = {}) => (
  <LessonStaffTools lessonId="l1" lessonPath={PATH} preview={false} {...over} />
);

beforeEach(() => clearMyLessonProgress.mockReset());

describe("LessonStaffTools", () => {
  it("offers recording only for a preview, as a link that opens the lesson with ?track=1", () => {
    const { rerender } = render(tools());
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    rerender(tools({ preview: true }));
    expect(screen.getByRole("link", { name: "Record my watching in this preview" })).toHaveAttribute("href", `${PATH}?track=1`);
  });

  it("asks before clearing, and does nothing on cancel", async () => {
    const user = userEvent.setup();
    render(tools());
    await user.click(screen.getByRole("button", { name: "Clear my progress for this lesson" }));
    expect(screen.getByText(/Delete your watch segments and progress/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(clearMyLessonProgress).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Clear my progress for this lesson" })).toBeInTheDocument();
  });

  it("clears this lesson's progress once confirmed", async () => {
    clearMyLessonProgress.mockResolvedValue({ segments: 3 });
    const user = userEvent.setup();
    render(tools());
    await user.click(screen.getByRole("button", { name: "Clear my progress for this lesson" }));
    await user.click(screen.getByRole("button", { name: "Yes, clear" }));

    expect(clearMyLessonProgress).toHaveBeenCalledWith("l1");
    expect(await screen.findByRole("status")).toHaveTextContent("Cleared 3 watch segments");
  });

  it("shows why it failed", async () => {
    clearMyLessonProgress.mockResolvedValue({ error: "Not available" });
    const user = userEvent.setup();
    render(tools());
    await user.click(screen.getByRole("button", { name: "Clear my progress for this lesson" }));
    await user.click(screen.getByRole("button", { name: "Yes, clear" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Not available");
  });
});
