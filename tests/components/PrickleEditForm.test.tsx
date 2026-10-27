// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import PrickleDetails from "@/components/PrickleDetails";
import type { PrickleEditConfig } from "@/components/PrickleEditForm";
import type { PrickleDetail } from "@/lib/domain/prickle";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const prickle: PrickleDetail = {
  id: "prkl_AAAAAAAAAAA1",
  typeId: "prty_AAAAAAAAAAA1",
  hostId: "mbr_AAAAAAAAAAA1",
  title: "Book Fair Intro",
  description: "From the calendar",
  guestSpeaker: null,
  startTime: "2026-10-20T15:00:00Z",
  endTime: "2026-10-20T16:00:00Z",
  source: "calendar",
  calendarEventId: "00000000-0000-4000-8000-00000000000a",
  host: { id: "mbr_AAAAAAAAAAA1", name: "Jenn Parker", displayName: null },
  type: { id: "prty_AAAAAAAAAAA1", name: "Hedgie-A-Thon", normalizedName: "hedgie-a-thon", description: null, purpose: "writing", requiresHost: true, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false },
};

const onSave = vi.fn();
const config = (over: Partial<PrickleEditConfig> = {}): PrickleEditConfig => ({
  types: [
    { id: "prty_AAAAAAAAAAA1", name: "Hedgie-A-Thon" },
    { id: "prty_AAAAAAAAAAA2", name: "Book Fair" },
  ],
  members: [
    { id: "mbr_AAAAAAAAAAA1", name: "Jenn Parker", email: "jenn@example.test" },
    { id: "mbr_AAAAAAAAAAA2", name: "Ada Example", email: "ada@example.test" },
  ],
  overridden: { title: false, description: false, guestSpeaker: false },
  onSave,
  ...over,
});

const renderDetails = (edit?: PrickleEditConfig, p: PrickleDetail = prickle) =>
  render(
    <PrickleDetails
      prickle={p}
      attendanceRecords={[]}
      hostMissing={false}
      hostLate={false}
      userTimezonePreference="America/New_York"
      memberBasePath="/admin/members"
      showMemberEmails={true}
      edit={edit}
    />,
  );

beforeEach(() => {
  onSave.mockReset();
  onSave.mockResolvedValue({ success: true });
  refresh.mockClear();
});
afterEach(cleanup);

describe("the prickle details card", () => {
  it("has no Edit button for anyone who can't edit (members, or a prickle that isn't from the calendar)", () => {
    renderDetails(undefined);
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("turns the type, host, title, description and guest speaker into fields, and keeps the date and time as text", async () => {
    renderDetails(config());
    expect(screen.getByText("Hedgie-A-Thon")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByRole("heading", { name: "Edit prickle" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Book Fair Intro");
    expect(screen.getByLabelText("Description")).toHaveValue("From the calendar");
    expect(screen.getByLabelText("Type")).toHaveValue("prty_AAAAAAAAAAA1");
    expect(screen.getByLabelText("Guest speaker")).toHaveValue("");
    expect(screen.getByText("Jenn Parker")).toBeInTheDocument(); // the host, in the search
    expect(screen.queryByText("Type:")).not.toBeInTheDocument(); // the read-only cells are replaced
    expect(screen.getByText("Date:")).toBeInTheDocument();
    expect(screen.getByText("Time:")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("goes back to the text on Cancel, saving nothing", async () => {
    renderDetails(config());
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.type(screen.getByLabelText("Title"), " changed");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Book Fair Intro" })).toBeInTheDocument();
  });

  it("saves only what changed, then closes and refreshes", async () => {
    renderDetails(config());
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.clear(screen.getByLabelText("Title"));
    await userEvent.type(screen.getByLabelText("Title"), "Book Fair: Meet the Fair");
    await userEvent.selectOptions(screen.getByLabelText("Type"), "prty_AAAAAAAAAAA2");
    await userEvent.type(screen.getByLabelText("Guest speaker"), "Ada Example");

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ title: "Book Fair: Meet the Fair", typeId: "prty_AAAAAAAAAAA2", guestSpeaker: "Ada Example" });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Edit prickle" })).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });

  it("closes without saving when nothing changed", async () => {
    renderDetails(config());
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Edit prickle" })).not.toBeInTheDocument();
  });

  it("sends an emptied field as empty, which follows the calendar again", async () => {
    renderDetails(config({ overridden: { title: true, description: false, guestSpeaker: false } }));
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText("(edited)")).toBeInTheDocument(); // only the title was set by hand
    await userEvent.clear(screen.getByLabelText(/^Title/));

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ title: "" }));
  });

  it("changes the host to the member picked", async () => {
    renderDetails(config());
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: /clear/i })); // the search shows the current host with a clear button
    await userEvent.type(screen.getByPlaceholderText("Search for the host..."), "Ada");
    await userEvent.click(await screen.findByText("Ada Example"));

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ hostId: "mbr_AAAAAAAAAAA2" }));
  });

  it("keeps the host when the picker is cleared and nobody else is picked", async () => {
    renderDetails(config());
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).not.toHaveBeenCalled();
  });

  it("stays open and shows why when saving fails", async () => {
    onSave.mockResolvedValue({ error: "The calendar event is gone, so the change wouldn't last" });
    renderDetails(config());
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.type(screen.getByLabelText("Title"), "!");

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("The calendar event is gone, so the change wouldn't last")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Edit prickle" })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows the host by the name the community knows them by", async () => {
    const members = [
      { id: "mbr_AAAAAAAAAAA1", name: "Jennifer Parker", displayName: "Jenny", email: "jenn@example.test" },
      { id: "mbr_AAAAAAAAAAA2", name: "Ada Example", email: "ada@example.test" },
    ];
    renderDetails(config({ members }), { ...prickle, host: { id: "mbr_AAAAAAAAAAA1", name: "Jennifer Parker", displayName: "Jenny" } });
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByText("Jenny")).toBeInTheDocument();
    expect(screen.queryByText("Jennifer Parker")).not.toBeInTheDocument();
  });

  it("offers a prickle with no type the Unknown option", async () => {
    renderDetails(config(), { ...prickle, typeId: null, type: null });
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByRole("option", { name: "Unknown" })).toBeInTheDocument();
  });
});
