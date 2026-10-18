// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/app/(member)/settings/actions", () => ({ updateTimezonePreference: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { TimezoneInitializer } from "@/components/TimezoneInitializer";

function detectedZone(zone: string) {
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({ timeZone: zone } as Intl.ResolvedDateTimeFormatOptions);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("TimezoneInitializer prompt", () => {
  it("asks when the saved zone differs from the browser's at page load", () => {
    detectedZone("America/Chicago");
    render(<TimezoneInitializer storedTimezone="America/New_York" isSudo={false} />);
    expect(screen.getByText(/Change time zone to/)).toBeInTheDocument();
  });

  it("doesn't ask again when the saved zone changes later (a choice made in Settings)", () => {
    detectedZone("America/Chicago");
    const { rerender } = render(<TimezoneInitializer storedTimezone="America/Chicago" isSudo={false} />);
    expect(screen.queryByText(/Change time zone to/)).toBeNull();
    rerender(<TimezoneInitializer storedTimezone="Europe/Paris" isSudo={false} />);
    expect(screen.queryByText(/Change time zone to/)).toBeNull();
  });
});
