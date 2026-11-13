// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CopyLessonLink from "@/app/(member)/courses/CopyLessonLink";
import { PlayerTimeProvider, TimedLessonPlayer } from "@/components/courses/PlayerTime";

vi.mock("@/components/courses/LessonPlayer", () => ({
  default: ({ onTime }: { onTime?: (seconds: number) => void }) => <button onClick={() => onTime?.(95)}>Move to 1:35</button>,
}));

const ADDRESS = "https://hub.example.com/courses/c/lessons/les_AAAAAAAAAAA1";

afterEach(cleanup);

describe("CopyLessonLink", () => {
  it("copies the lesson address and says so, with the hint about Hub Chat", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CopyLessonLink url={ADDRESS} />);
    expect(screen.getByText(/paste it into hub chat/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Copy link" }));

    expect(writeText).toHaveBeenCalledWith(ADDRESS);
    expect(screen.getByRole("status")).toHaveTextContent("Copied.");
  });

  it("says so when the browser refuses", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("no")) }, configurable: true });
    render(<CopyLessonLink url={ADDRESS} />);

    await userEvent.click(screen.getByRole("button", { name: "Copy link" }));

    expect(screen.getByRole("status")).toHaveTextContent("Couldn't copy");
  });

  it("copies the address at the player's position once it is past the start", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(
      <PlayerTimeProvider>
        <TimedLessonPlayer {...({} as React.ComponentProps<typeof TimedLessonPlayer>)} />
        <CopyLessonLink url={ADDRESS} />
      </PlayerTimeProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenLastCalledWith(ADDRESS);

    await userEvent.click(screen.getByRole("button", { name: "Move to 1:35" }));
    await userEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenLastCalledWith(`${ADDRESS}?t=95`);
  });
});
