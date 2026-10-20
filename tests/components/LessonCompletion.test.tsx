// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const setLessonComplete = vi.fn<(lessonId: string, complete: boolean) => Promise<{ error?: string }>>();
vi.mock("@/app/(member)/courses/actions", () => ({ setLessonComplete: (...a: [string, boolean]) => setLessonComplete(...a) }));

import { AUTO_COMPLETE_FRACTION, LessonCompletionProvider, useLessonCompletion } from "@/app/(member)/courses/LessonCompletion";

/** Exposes the provider's state and actions to the test. */
let current: ReturnType<typeof useLessonCompletion> = null;
function Probe() {
  current = useLessonCompletion();
  return <div data-testid="state">{current?.completed ? "complete" : "open"}</div>;
}
const ui = (over: { initiallyCompleted?: boolean; readOnlyReason?: string | null } = {}) => (
  <LessonCompletionProvider lessonId="l1" initiallyCompleted={over.initiallyCompleted ?? false} readOnlyReason={over.readOnlyReason ?? null}>
    <Probe />
    <button onClick={() => current?.toggle()}>toggle</button>
  </LessonCompletionProvider>
);

beforeEach(() => {
  setLessonComplete.mockReset();
  setLessonComplete.mockResolvedValue({});
  current = null;
});

describe("LessonCompletionProvider", () => {
  it("watched mark is about 90%", () => {
    expect(AUTO_COMPLETE_FRACTION).toBe(0.9);
  });

  it("completes the lesson when the player reaches the mark, once, and tells the server", async () => {
    render(ui());
    await act(async () => current!.autoComplete());
    await act(async () => current!.autoComplete());
    await act(async () => current!.autoComplete());

    expect(screen.getByTestId("state")).toHaveTextContent("complete");
    expect(setLessonComplete).toHaveBeenCalledTimes(1);
    expect(setLessonComplete).toHaveBeenCalledWith("l1", true);
  });

  it("does nothing for a lesson that's already complete", async () => {
    render(ui({ initiallyCompleted: true }));
    await act(async () => current!.autoComplete());

    expect(setLessonComplete).not.toHaveBeenCalled();
  });

  it("does nothing when read-only (sudo, a staff preview), and the button can't change it either", async () => {
    render(ui({ readOnlyReason: "preview" }));
    await act(async () => current!.autoComplete());
    await userEvent.click(screen.getByRole("button", { name: "toggle" }));

    expect(screen.getByTestId("state")).toHaveTextContent("open");
    expect(setLessonComplete).not.toHaveBeenCalled();
  });

  it("never completes behind the member's back once they have cleared it themselves", async () => {
    render(ui({ initiallyCompleted: true }));
    await userEvent.click(screen.getByRole("button", { name: "toggle" })); // the member clears it
    expect(screen.getByTestId("state")).toHaveTextContent("open");

    await act(async () => current!.autoComplete()); // the video is still playing past the mark
    expect(screen.getByTestId("state")).toHaveTextContent("open");
    expect(setLessonComplete).toHaveBeenCalledTimes(1);
    expect(setLessonComplete).toHaveBeenCalledWith("l1", false);
  });

  it("puts it back, and says why, when the server refuses an automatic completion", async () => {
    setLessonComplete.mockResolvedValue({ error: "You don't have access to this course" });
    render(ui());
    await act(async () => current!.autoComplete());

    expect(screen.getByTestId("state")).toHaveTextContent("open");
    expect(current!.error).toBe("You don't have access to this course");
  });

  it("is null outside a provider, so the player just plays", () => {
    render(<Probe />);
    expect(current).toBeNull();
  });
});
