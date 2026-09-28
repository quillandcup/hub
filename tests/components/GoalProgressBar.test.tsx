// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import GoalProgressBar from "@/components/writing/GoalProgressBar";

const BASE = { measure: "words" as const, current: 38681, target: 55629, percent: 69.5, parTarget: 55629, onPace: false };

describe("GoalProgressBar", () => {
  it("shows pace while the goal is active", () => {
    render(<GoalProgressBar {...BASE} endDate="2026-03-13" />);
    expect(screen.getByText("Behind pace")).toBeInTheDocument();
    expect(screen.getByText(/by 2026-03-13/)).toBeInTheDocument();
    expect(screen.getByTitle("Pace needed to finish on time")).toBeInTheDocument();
  });

  it("says Ended, not Behind pace, once the end date has passed", () => {
    render(<GoalProgressBar {...BASE} status="ended" endDate="2026-03-13" />);
    expect(screen.getByText("Ended")).toBeInTheDocument();
    expect(screen.queryByText("Behind pace")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Pace needed to finish on time")).not.toBeInTheDocument();
  });

  it("says Achieved! once the target is reached", () => {
    render(<GoalProgressBar {...BASE} current={55629} percent={100} onPace status="achieved" />);
    expect(screen.getByText("Achieved!")).toBeInTheDocument();
    expect(screen.queryByText("On pace")).not.toBeInTheDocument();
  });
});
