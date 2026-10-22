// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const spinWheel = vi.hoisted(() => vi.fn());
vi.mock("@/app/(member)/wheel-of-wonder/actions", () => ({ spinWheel }));

import Wheel from "@/app/(member)/wheel-of-wonder/Wheel";

const winner = {
  memberId: "mbr_1",
  memberName: "Fern Quillsby",
  photoUrl: null,
  dmUrl: "https://slack.example/dm",
  roomCreated: true,
  starterText: null,
};

describe("Wheel", () => {
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    spinWheel.mockResolvedValue({ winner, reel: [winner] });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  /** Spins and runs the animation to its end (the next frame, a long time later). */
  async function spinToTheEnd() {
    render(<Wheel />);
    await userEvent.click(screen.getByRole("button", { name: /spin/i }));
    await act(async () => frames.shift()!(performance.now() + 60_000));
  }

  it("is the container its result buttons query, full width so a centering parent can't shrink it to nothing", () => {
    const { container } = render(<Wheel />);

    expect(container.firstElementChild).toHaveClass("@container", "w-full");
  });

  it("shows the winner's buttons stacked until there is room for a row (@pair)", async () => {
    await spinToTheEnd();

    const slack = screen.getByRole("link", { name: /Message on Slack/ });
    expect(slack).toHaveAttribute("href", winner.dmUrl);
    expect(slack.parentElement).toHaveClass("flex-col", "@pair:flex-row", "@pair:justify-center");
    expect(screen.getByRole("button", { name: "Spin Again" })).toBeInTheDocument();
  });
});
