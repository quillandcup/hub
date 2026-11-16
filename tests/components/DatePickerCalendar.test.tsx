// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import DatePicker from "@/components/DatePicker";

afterEach(cleanup);

const calendar = (props: Partial<React.ComponentProps<typeof DatePicker>> = {}) => {
  const onChange = vi.fn();
  render(<DatePicker inline id="d" label="Choose a date" value="" today="2026-11-13" onChange={onChange} {...props} />);
  return { onChange, user: userEvent.setup() };
};

describe("DatePicker inline calendar", () => {
  it("shows the month of today, Sunday first, with today marked", () => {
    calendar();
    expect(screen.getByRole("group", { name: "Choose a date" })).toBeInTheDocument();
    expect(screen.getByText("November 2026")).toBeInTheDocument();
    expect(screen.getByText("Su")).toBeInTheDocument();
    expect(screen.getByText("Sa")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "November 13, 2026" })).toHaveAttribute("aria-current", "date");
    // November 1st, 2026 is a Sunday: the first cell of the grid.
    expect(screen.getAllByRole("button", { name: /^November \d+, 2026$/ })).toHaveLength(30);
  });

  it("starts on the month of the selected day and marks it", () => {
    calendar({ value: "2025-02-14" });
    expect(screen.getByText("February 2025")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "February 14, 2025" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("button", { name: /^February \d+, 2025$/ })).toHaveLength(28);
  });

  it("moves by month and by year, across the year's end", async () => {
    const { user } = calendar({ today: "2026-12-05" });
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("January 2027")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("November 2026")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Previous year" }));
    expect(screen.getByText("November 2025")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next year" }));
    await user.click(screen.getByRole("button", { name: "Next year" }));
    expect(screen.getByText("November 2027")).toBeInTheDocument();
  });

  it("reports the chosen day as YYYY-MM-DD", async () => {
    const { user, onChange } = calendar();
    await user.click(screen.getByRole("button", { name: "November 9, 2026" }));
    expect(onChange).toHaveBeenCalledWith("2026-11-09");
  });

  it("does not offer days outside min and max", async () => {
    const { user, onChange } = calendar({ min: "2026-11-05", max: "2026-11-20" });
    expect(screen.getByRole("button", { name: "November 4, 2026" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "November 21, 2026" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "November 4, 2026" }));
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "November 5, 2026" }));
    expect(onChange).toHaveBeenCalledWith("2026-11-05");
  });

  it("still renders the native input by default", () => {
    render(<DatePicker id="n" label="Start" value="2026-11-13" onChange={() => {}} />);
    expect(screen.getByLabelText("Start")).toHaveAttribute("type", "date");
  });
});
