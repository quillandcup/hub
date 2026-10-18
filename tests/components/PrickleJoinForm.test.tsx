// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn() }));
vi.mock("@/app/(admin)/admin/prickle-join/actions", () => ({
  savePrickleJoin: mocks.save,
  removeScheduledPrickleJoin: mocks.remove,
}));

import PrickleJoinForm from "@/app/(admin)/admin/prickle-join/PrickleJoinForm";
import RemoveScheduledButton from "@/app/(admin)/admin/prickle-join/RemoveScheduledButton";
import DatePicker from "@/components/DatePicker";

const renderForm = () =>
  render(
    <PrickleJoinForm
      url="https://zoom.example.test/j/1"
      passcode="old"
      timeZone="America/New_York"
      defaultStartDate="2099-02-01"
      minStartDate="2099-01-02"
    />
  );

beforeEach(() => {
  mocks.save.mockReset().mockResolvedValue({ success: true });
  mocks.remove.mockReset().mockResolvedValue({ success: true });
});

describe("PrickleJoinForm", () => {
  it("saves the link and passcode for the default start day, and confirms it", async () => {
    const user = userEvent.setup();
    renderForm();
    expect(screen.getByLabelText("Starting on")).toHaveValue("2099-02-01");
    expect(screen.getByLabelText("Starting on")).toHaveAttribute("min", "2099-01-02");

    await user.clear(screen.getByLabelText("Passcode"));
    await user.type(screen.getByLabelText("Passcode"), "new");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({ url: "https://zoom.example.test/j/1", passcode: "new", startDate: "2099-02-01" })
    );
    expect(await screen.findByText("Saved. Applies to prickles starting 2099-02-01 and later.")).toBeInTheDocument();
  });

  it("starts right now when asked, ignoring the date", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("checkbox", { name: "Start right now instead" }));
    expect(screen.getByLabelText("Starting on")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ startDate: "" })));
    expect(await screen.findByText("Saved. Applies to prickles starting now.")).toBeInTheDocument();
  });

  it("shows why a save failed", async () => {
    const user = userEvent.setup();
    mocks.save.mockResolvedValue({ error: "Enter the full https:// join link" });
    renderForm();
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Enter the full https:// join link")).toBeInTheDocument();
  });
});

describe("RemoveScheduledButton", () => {
  it("removes the scheduled setting", async () => {
    const user = userEvent.setup();
    render(<RemoveScheduledButton id="s1" />);
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(mocks.remove).toHaveBeenCalledWith("s1");
  });

  it("shows why it couldn't", async () => {
    const user = userEvent.setup();
    mocks.remove.mockResolvedValue({ error: "That change already took effect, so it can't be removed" });
    render(<RemoveScheduledButton id="s1" />);
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByText("That change already took effect, so it can't be removed")).toBeInTheDocument();
  });
});

describe("DatePicker", () => {
  it("reports the chosen day", () => {
    const onChange = vi.fn();
    render(<DatePicker id="d" label="Day" value="" onChange={onChange} min="2099-01-02" required />);
    const input = screen.getByLabelText("Day");
    expect(input).toBeRequired();
    fireEvent.change(input, { target: { value: "2099-03-04" } });
    expect(onChange).toHaveBeenCalledWith("2099-03-04");
    expect(input).toHaveAttribute("type", "date");
  });
});
