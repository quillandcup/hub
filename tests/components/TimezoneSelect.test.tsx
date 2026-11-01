// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TimezoneSelect from "@/components/TimezoneSelect";

describe("TimezoneSelect", () => {
  it("lists only the presets for a preset zone", () => {
    render(<TimezoneSelect value="America/Chicago" onChange={() => {}} track="t" />);
    expect(screen.getByRole("combobox")).toHaveValue("America/Chicago");
    expect(screen.getAllByRole("option")).toHaveLength(5);
  });

  it("adds and selects the member's own zone when it isn't a preset", () => {
    render(<TimezoneSelect value="America/Costa_Rica" onChange={() => {}} track="t" />);
    expect(screen.getByRole("combobox")).toHaveValue("America/Costa_Rica");
    expect(screen.getByRole("option", { name: "Costa Rica" })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(6);
  });

  it("reports the zone picked", async () => {
    const onChange = vi.fn();
    render(<TimezoneSelect value="America/Costa_Rica" onChange={onChange} track="t" />);
    await userEvent.selectOptions(screen.getByRole("combobox"), "America/New_York");
    expect(onChange).toHaveBeenCalledWith("America/New_York");
  });
});
