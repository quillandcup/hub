// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const spinWheel = vi.hoisted(() => vi.fn());
const introduceOnSlack = vi.hoisted(() => vi.fn());
vi.mock("@/app/(member)/wheel-of-wonder/actions", () => ({ spinWheel, introduceOnSlack }));

import Wheel from "@/app/(member)/wheel-of-wonder/Wheel";

const winner = {
  memberId: "mbr_1",
  memberName: "Fern Quillsby",
  photoUrl: null,
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

    const slack = screen.getByRole("button", { name: /Message on Slack/ });
    expect(slack.parentElement).toHaveClass("flex-col", "@pair:flex-row", "@pair:justify-center");
    expect(screen.getByRole("button", { name: "Spin Again" })).toBeInTheDocument();
  });

  it("tells the member what Message on Slack will do, and sends nothing until they click it", async () => {
    await spinToTheEnd();

    expect(screen.getByText(/has Billie start a chat/)).toBeInTheDocument();
    expect(introduceOnSlack).not.toHaveBeenCalled();
  });

  it("introduces the pair only on click, then offers the icebreaker when no room could be made", async () => {
    introduceOnSlack.mockResolvedValue({ url: "https://slack.example/dm", roomCreated: false, starterText: "Ask about their week" });
    await spinToTheEnd();

    await userEvent.click(screen.getByRole("button", { name: /Message on Slack/ }));

    expect(introduceOnSlack).toHaveBeenCalledWith(winner.memberId);
    expect(await screen.findByText("Ask about their week")).toBeInTheDocument();
  });

  it("shows the error when the introduction fails", async () => {
    introduceOnSlack.mockResolvedValue({ error: "Couldn't find that member on Slack" });
    await spinToTheEnd();

    await userEvent.click(screen.getByRole("button", { name: /Message on Slack/ }));

    expect(await screen.findByText("Couldn't find that member on Slack")).toBeInTheDocument();
  });
});
