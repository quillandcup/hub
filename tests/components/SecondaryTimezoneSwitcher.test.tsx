// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ORG_TIMEZONE } from "@/lib/config";
import { SecondaryTimezoneSwitcher } from "@/app/(member)/settings/SecondaryTimezoneSwitcher";
import { updateSecondaryTimezone } from "@/app/(member)/settings/actions";

vi.mock("@/app/(member)/settings/actions", () => ({
  updateSecondaryTimezone: vi.fn(),
  updateTimezonePreference: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(updateSecondaryTimezone).mockReset().mockResolvedValue({ success: true } as never);
});

describe("SecondaryTimezoneSwitcher", () => {
  it("is off by default, with no zone picker", () => {
    render(<SecondaryTimezoneSwitcher initialTimezone={null} />);
    expect(screen.getByRole("checkbox", { name: /second time zone/i })).not.toBeChecked();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("turning it on saves the org zone and shows the picker", async () => {
    render(<SecondaryTimezoneSwitcher initialTimezone={null} />);
    await userEvent.click(screen.getByRole("checkbox"));
    expect(updateSecondaryTimezone).toHaveBeenCalledWith(ORG_TIMEZONE);
    expect(await screen.findByRole("combobox")).toHaveValue(ORG_TIMEZONE);
  });

  it("changing the zone saves it, and turning it off saves null", async () => {
    render(<SecondaryTimezoneSwitcher initialTimezone={ORG_TIMEZONE} />);
    await userEvent.selectOptions(screen.getByRole("combobox"), "Europe/London");
    expect(updateSecondaryTimezone).toHaveBeenCalledWith("Europe/London");
    await waitFor(() => expect(screen.getByRole("checkbox")).not.toBeDisabled());
    await userEvent.click(screen.getByRole("checkbox"));
    expect(updateSecondaryTimezone).toHaveBeenLastCalledWith(null);
  });

  it("reverts when saving fails", async () => {
    vi.mocked(updateSecondaryTimezone).mockResolvedValue({ error: "nope" } as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<SecondaryTimezoneSwitcher initialTimezone={null} />);
    await userEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(screen.getByRole("checkbox")).not.toBeChecked());
  });
});
