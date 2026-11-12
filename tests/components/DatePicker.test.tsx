// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import DatePicker from "@/components/DatePicker";

describe("DatePicker", () => {
  it("is a labelled day input that reports the day picked", () => {
    const onChange = vi.fn();
    render(<DatePicker id="when" label="When" value="2026-03-10" onChange={onChange} />);

    const input = screen.getByLabelText("When");
    expect(input).toHaveValue("2026-03-10");
    fireEvent.change(input, { target: { value: "2026-03-12" } });
    expect(onChange).toHaveBeenCalledWith("2026-03-12");
  });

  it("limits the days that can be picked from both ends", () => {
    render(<DatePicker id="when" label="When" value="" onChange={() => {}} min="2026-03-01" max="2026-03-20" />);
    expect(screen.getByLabelText("When")).toHaveAttribute("min", "2026-03-01");
    expect(screen.getByLabelText("When")).toHaveAttribute("max", "2026-03-20");
  });

  it("has no limit unless given one", () => {
    render(<DatePicker id="when" label="When" value="" onChange={() => {}} />);
    expect(screen.getByLabelText("When")).not.toHaveAttribute("max");
    expect(screen.getByLabelText("When")).not.toHaveAttribute("min");
  });
});
