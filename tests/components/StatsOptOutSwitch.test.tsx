// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const setAnalyticsOptOut = vi.fn();
vi.mock("@/app/privacy/actions", () => ({ setAnalyticsOptOut: (on: boolean) => setAnalyticsOptOut(on) }));

import { StatsOptOutSwitch } from "@/app/privacy/StatsOptOutSwitch";

beforeEach(() => setAnalyticsOptOut.mockReset());

const toggle = () => screen.getByRole("switch", { name: "Share usage statistics" });

describe("StatsOptOutSwitch", () => {
  it("turns off, saying how the earlier statistics were removed", async () => {
    setAnalyticsOptOut.mockResolvedValue({ success: true, removed: 12 });
    render(<StatsOptOutSwitch initialOptedOut={false} readOnly={false} />);
    expect(toggle()).toHaveAttribute("aria-checked", "true");

    await userEvent.click(toggle());

    expect(setAnalyticsOptOut).toHaveBeenCalledWith(true);
    await waitFor(() => expect(toggle()).toHaveAttribute("aria-checked", "false"));
    expect(screen.getByRole("status")).toHaveTextContent("We removed the usage statistics recorded under your account");
  });

  it("says nothing was there to remove when there was nothing", async () => {
    setAnalyticsOptOut.mockResolvedValue({ success: true, removed: 0 });
    render(<StatsOptOutSwitch initialOptedOut={false} readOnly={false} />);
    await userEvent.click(toggle());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("We record no usage statistics for you"));
  });

  it("turns back on", async () => {
    setAnalyticsOptOut.mockResolvedValue({ success: true, removed: 0 });
    render(<StatsOptOutSwitch initialOptedOut={true} readOnly={false} />);
    expect(toggle()).toHaveAttribute("aria-checked", "false");

    await userEvent.click(toggle());

    expect(setAnalyticsOptOut).toHaveBeenCalledWith(false);
    await waitFor(() => expect(toggle()).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByRole("status")).toHaveTextContent("Usage statistics are on");
  });

  it("stays where it was and shows the error when saving fails", async () => {
    setAnalyticsOptOut.mockResolvedValue({ error: "Couldn't save that. Please try again." });
    render(<StatsOptOutSwitch initialOptedOut={false} readOnly={false} />);
    await userEvent.click(toggle());
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save that");
    expect(toggle()).toHaveAttribute("aria-checked", "true");
  });

  it("can't be changed while viewing as a member", async () => {
    render(<StatsOptOutSwitch initialOptedOut={false} readOnly />);
    expect(toggle()).toBeDisabled();
    expect(screen.getByText(/can't be changed while viewing as a member/)).toBeInTheDocument();
    await userEvent.click(toggle());
    expect(setAnalyticsOptOut).not.toHaveBeenCalled();
  });
});
