// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/app/(member)/settings/actions", () => ({ updateTimezonePreference: vi.fn() }));

import { TimezoneSwitcher } from "@/app/(member)/settings/TimezoneSwitcher";

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
    expect(screen.getByRole("option", { name: "Europe/Dublin" })).toBeInTheDocument();
  });
});
