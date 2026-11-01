// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/(member)/settings/actions", () => ({ updateTimezonePreference: vi.fn() }));

import { TimezoneSwitcher } from "@/app/(member)/settings/TimezoneSwitcher";
import { updateTimezonePreference } from "@/app/(member)/settings/actions";

function detectedZone(zone: string) {
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({ timeZone: zone } as Intl.ResolvedDateTimeFormatOptions);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TimezoneSwitcher", () => {
  it("has no auto-detect choice", () => {
    detectedZone("America/Chicago");
    render(<TimezoneSwitcher initialTimezone="America/Chicago" />);
    expect(screen.queryByRole("option", { name: /auto-detect/i })).toBeNull();
    expect(screen.queryByRole("option", { name: /browser/i })).toBeNull();
  });

  it("shows the detected zone while the stored one is still 'browser'", () => {
    detectedZone("America/Denver");
    render(<TimezoneSwitcher initialTimezone="browser" />);
    expect(screen.getByRole("combobox")).toHaveValue("America/Denver");
  });

  it("lists a zone that isn't in the common list so it can show as selected", () => {
    detectedZone("Europe/Dublin");
    render(<TimezoneSwitcher initialTimezone="browser" />);
    expect(screen.getByRole("combobox")).toHaveValue("Europe/Dublin");
    expect(screen.getByRole("option", { name: "Europe/Dublin (current location)" })).toBeInTheDocument();
  });

  it("follows the saved zone when the page refreshes with a new one", () => {
    detectedZone("America/Chicago");
    const { rerender } = render(<TimezoneSwitcher initialTimezone="America/Chicago" />);
    rerender(<TimezoneSwitcher initialTimezone="Europe/Paris" />);
    expect(screen.getByRole("combobox")).toHaveValue("Europe/Paris");
  });

  it("keeps the browser's zone as an option after another is picked, with a button to go back to it", async () => {
    detectedZone("America/Costa_Rica");
    vi.mocked(updateTimezonePreference).mockResolvedValue({ success: true });
    render(<TimezoneSwitcher initialTimezone="America/Costa_Rica" />);
    expect(screen.queryByRole("button", { name: /current location/ })).toBeNull();

    await userEvent.selectOptions(screen.getByRole("combobox"), "America/Chicago");

    expect(screen.getByRole("option", { name: "America/Costa Rica (current location)" })).toBeInTheDocument();
    const locateButton = screen.getByRole("button", { name: "Use current location (America/Costa Rica)" });
    const icon = locateButton.querySelector("svg");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveClass("lucide-locate");
    await userEvent.click(locateButton);
    expect(updateTimezonePreference).toHaveBeenLastCalledWith("America/Costa_Rica");
    expect(screen.getByRole("combobox")).toHaveValue("America/Costa_Rica");
  });
});
