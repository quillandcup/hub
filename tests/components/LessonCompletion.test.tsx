// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const setLessonComplete = vi.fn<(lessonId: string, complete: boolean) => Promise<{ error?: string }>>();
vi.mock("@/app/(member)/courses/actions", () => ({ setLessonComplete: (...a: [string, boolean]) => setLessonComplete(...a) }));

const track = vi.fn();
vi.mock("@/lib/analytics/client", () => ({ track: (...a: unknown[]) => track(...a) }));

import { AUTO_COMPLETE_FRACTION, LessonCompletionProvider, useLessonCompletion } from "@/app/(member)/courses/LessonCompletion";

/** Shows the provider's state and exposes its two actions as buttons, as the player and the button do. */
function Probe() {
  const completion = useLessonCompletion();
  if (!completion) return <div data-testid="state">no provider</div>;
  return (
    <div>
      <div data-testid="state">{completion.completed ? "complete" : "open"}</div>
      <div data-testid="error">{completion.error ?? ""}</div>
      <button onClick={completion.autoComplete}>auto</button>
      <button onClick={completion.toggle}>toggle</button>
    </div>
  );
}
const ui = (over: { initiallyCompleted?: boolean; readOnlyReason?: string | null } = {}) => (
  <LessonCompletionProvider lessonId="l1" initiallyCompleted={over.initiallyCompleted ?? false} readOnlyReason={over.readOnlyReason ?? null}>
    <Probe />
  </LessonCompletionProvider>
);
const auto = () => userEvent.click(screen.getByRole("button", { name: "auto" }));
const toggle = () => userEvent.click(screen.getByRole("button", { name: "toggle" }));

beforeEach(() => {
  track.mockReset();
  setLessonComplete.mockReset();
  setLessonComplete.mockResolvedValue({});
});

describe("LessonCompletionProvider", () => {
  it("watched mark is about 90%", () => {
    expect(AUTO_COMPLETE_FRACTION).toBe(0.9);
  });

  it("completes the lesson when the player reaches the mark, once, and tells the server", async () => {
    render(ui());
    await auto();
    await auto();
    await auto();

    expect(screen.getByTestId("state")).toHaveTextContent("complete");
    expect(setLessonComplete).toHaveBeenCalledTimes(1);
    expect(setLessonComplete).toHaveBeenCalledWith("l1", true);
  });

  it("does nothing for a lesson that's already complete", async () => {
    render(ui({ initiallyCompleted: true }));
    await auto();

    expect(setLessonComplete).not.toHaveBeenCalled();
  });

  it("does nothing when read-only (sudo, a staff preview), and the button can't change it either", async () => {
    render(ui({ readOnlyReason: "preview" }));
    await auto();
    await toggle();

    expect(screen.getByTestId("state")).toHaveTextContent("open");
    expect(setLessonComplete).not.toHaveBeenCalled();
  });

  it("never completes behind the member's back once they have cleared it themselves", async () => {
    render(ui({ initiallyCompleted: true }));
    await toggle(); // the member clears it
    expect(screen.getByTestId("state")).toHaveTextContent("open");

    await auto(); // the video is still playing past the mark
    expect(screen.getByTestId("state")).toHaveTextContent("open");
    expect(setLessonComplete).toHaveBeenCalledTimes(1);
    expect(setLessonComplete).toHaveBeenCalledWith("l1", false);
  });

  it("puts it back, and says why, when the server refuses an automatic completion", async () => {
    setLessonComplete.mockResolvedValue({ error: "You don't have access to this course" });
    render(ui());
    await auto();

    expect(await screen.findByText("You don't have access to this course")).toBeInTheDocument();
    expect(screen.getByTestId("state")).toHaveTextContent("open");
  });

  it("is null outside a provider, so the player just plays", () => {
    render(<Probe />);
    expect(screen.getByTestId("state")).toHaveTextContent("no provider");
  });
});

describe("usage analytics", () => {
  it("records the player completing it automatically, once", async () => {
    render(ui());
    await auto();
    await auto();
    expect(track.mock.calls).toEqual([["lesson_completion_changed", { completed: true, via: "watched" }]]);
  });

  it("records the member completing it and clearing it with the button", async () => {
    render(ui());
    await toggle();
    await toggle();
    expect(track.mock.calls).toEqual([
      ["lesson_completion_changed", { completed: true, via: "button" }],
      ["lesson_completion_changed", { completed: false, via: "button" }],
    ]);
  });

  it("records nothing when read-only, where nothing changes", async () => {
    render(ui({ readOnlyReason: "preview" }));
    await auto();
    await toggle();
    expect(track).not.toHaveBeenCalled();
  });
});
