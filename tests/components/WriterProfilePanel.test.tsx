// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WriterProfilePanel } from "@/app/(member)/settings/WriterProfilePanel";
import * as actions from "@/app/(member)/settings/writerProfileActions";
import { WRITER_PROFILES } from "@/lib/config";
import { WRITER_PREVIEW_PATH } from "@/lib/writer-profile";

vi.mock("@/app/(member)/settings/writerProfileActions", () => ({
  getMyWriterProfile: vi.fn(),
  loadHandleStatus: vi.fn(),
  claimWriterHandle: vi.fn(),
  setWriterProfileSwitch: vi.fn(),
  saveWriterProfileDetails: vi.fn(),
  addProfilePenName: vi.fn(),
}));

const noPage: actions.MyWriterProfile = {
  available: true,
  hasPage: false,
  handle: null,
  isPublic: false,
  publicNameAliasId: null,
  useAccountName: false,
  publicBio: "",
  nameChosen: true,
  nameChoices: [{ kind: "display", aliasId: null, label: "Ada Example" }],
  suggestedHandle: "ada-example",
  addressPrefix: "hub.example.test/w/",
  pageUrl: null,
  previewPath: WRITER_PREVIEW_PATH,
};
const withPage: actions.MyWriterProfile = { ...noPage, hasPage: true, handle: "ada-example", pageUrl: "https://hub.example.test/w/ada-example" };

const onChanged = vi.fn(async () => {});
const renderPanel = (settings: actions.MyWriterProfile) => render(<WriterProfilePanel settings={settings} onChanged={onChanged} />);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(actions.loadHandleStatus).mockResolvedValue({ status: "available" });
});

describe("WriterProfilePanel", () => {
  it("says what becomes public, calmly, that the items are chosen above, and that it is off until switched on", () => {
    renderPanel(noPage);

    expect(screen.getByRole("heading", { name: "Your writer profile on the web" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Public Profile/ })).not.toBeInTheDocument();
    expect(screen.getByText(/anyone can open without signing in/)).toBeInTheDocument();
    expect(screen.getByText(/opened to the\s+internet with the globe/)).toBeInTheDocument();
    expect(screen.getByText(/not your email, your writing or your prickles/)).toBeInTheDocument();
    expect(screen.getByText(/stays off until you switch it on/)).toBeInTheDocument();
  });

  it("starts with an address made from the display name, and asks for the address before the name", () => {
    renderPanel(noPage);

    expect(screen.getByLabelText("Your address")).toHaveValue("ada-example");
    expect(screen.getByText("hub.example.test/w/")).toBeInTheDocument();
    expect(screen.getByText(/We made this one from your display name/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Name shown")).not.toBeInTheDocument();
    expect(screen.getByText("Choose your address first. Until then it stays off.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View as a visitor" })).not.toBeInTheDocument();
  });

  it("holds no bio or photo choice any more: those are chosen item by item in the profile", () => {
    renderPanel(withPage);

    expect(screen.queryByLabelText("Bio")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Show my photo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save page details" })).not.toBeInTheDocument();
  });

  it("checks an address as they type, and saves it once it is free, then reloads the settings", async () => {
    vi.mocked(actions.claimWriterHandle).mockResolvedValue({ success: true, handle: "ada-writes", changed: false });
    renderPanel(noPage);
    const input = screen.getByLabelText("Your address");

    await userEvent.clear(input);
    await userEvent.type(input, "Ada-Writes");

    expect(await screen.findByText("That address is free.")).toBeInTheDocument();
    expect(actions.loadHandleStatus).toHaveBeenLastCalledWith("ada-writes");
    await userEvent.click(screen.getByRole("button", { name: "Save address" }));

    expect(actions.claimWriterHandle).toHaveBeenCalledWith("Ada-Writes");
    expect(await screen.findByText(/Address saved. Next, choose the name for your profile/)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it("refuses a handle that cannot be one at once, without asking the server", async () => {
    renderPanel(noPage);
    const input = screen.getByLabelText("Your address");

    await userEvent.clear(input);
    await userEvent.type(input, "ada example");

    expect(await screen.findByText(/lowercase letters and numbers/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save address" })).toBeDisabled();
    expect(actions.loadHandleStatus).not.toHaveBeenCalled();
  });

  it("says when an address is taken and keeps Save off", async () => {
    vi.mocked(actions.loadHandleStatus).mockResolvedValue({ status: "unavailable", message: "Someone already uses that address. Choose another." });
    renderPanel(noPage);
    const input = screen.getByLabelText("Your address");

    await userEvent.clear(input);
    await userEvent.type(input, "taken-name");

    expect(await screen.findByText("Someone already uses that address. Choose another.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save address" })).toBeDisabled();
  });

  it("asks before moving the page to a new address, and says what happens to the old one", async () => {
    vi.mocked(actions.claimWriterHandle).mockResolvedValue({ success: true, handle: "ada-writes", changed: true });
    renderPanel(withPage);
    const input = screen.getByLabelText("Your address");
    await userEvent.clear(input);
    await userEvent.type(input, "ada-writes");
    await screen.findByText("That address is free.");

    await userEvent.click(screen.getByRole("button", { name: "Change address" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName("Change your profile address?");
    expect(dialog).toHaveTextContent(`for ${WRITER_PROFILES.handleReservationDays} days`);
    expect(dialog).toHaveTextContent("sent to the new one");
    expect(actions.claimWriterHandle).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(actions.claimWriterHandle).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Change address" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Change address" }));
    await waitFor(() => expect(actions.claimWriterHandle).toHaveBeenCalledWith("ada-writes"));
    expect(await screen.findByText(/old one sends visitors to the new one/)).toBeInTheDocument();
  });

  it("turns the page on without a question, and asks before turning it off", async () => {
    vi.mocked(actions.setWriterProfileSwitch).mockResolvedValue({ success: true });
    renderPanel(withPage);

    await userEvent.click(screen.getByRole("checkbox", { name: /Show my profile on the web/ }));
    expect(actions.setWriterProfileSwitch).toHaveBeenCalledWith(true);
    expect(await screen.findByText("Your profile is on. Anyone can open it.")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it("tells its parent when the page goes on (so it can show who sees what) and when it goes off, and not when the switch is refused", async () => {
    const onTurnedOn = vi.fn();
    const onTurnedOff = vi.fn();
    vi.mocked(actions.setWriterProfileSwitch).mockResolvedValue({ success: true });
    const { unmount } = render(<WriterProfilePanel settings={withPage} onChanged={onChanged} onTurnedOn={onTurnedOn} onTurnedOff={onTurnedOff} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /Show my profile on the web/ }));
    await waitFor(() => expect(onTurnedOn).toHaveBeenCalledTimes(1));
    expect(onTurnedOff).not.toHaveBeenCalled();
    unmount();

    const second = render(<WriterProfilePanel settings={{ ...withPage, isPublic: true }} onChanged={onChanged} onTurnedOn={onTurnedOn} onTurnedOff={onTurnedOff} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /Show my profile on the web/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Turn off profile" }));
    await waitFor(() => expect(onTurnedOff).toHaveBeenCalledTimes(1));
    expect(onTurnedOn).toHaveBeenCalledTimes(1);
    second.unmount();

    vi.mocked(actions.setWriterProfileSwitch).mockResolvedValue({ error: "Not now." });
    onTurnedOn.mockClear();
    render(<WriterProfilePanel settings={withPage} onChanged={onChanged} onTurnedOn={onTurnedOn} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /Show my profile on the web/ }));
    expect(await screen.findByText("Not now.")).toBeInTheDocument();
    expect(onTurnedOn).not.toHaveBeenCalled();
  });

  it("shows the server's reason when the switch is refused, as a plain message", async () => {
    vi.mocked(actions.setWriterProfileSwitch).mockResolvedValue({ error: "Choose the name your profile shows first, under \"Name shown\"." });
    renderPanel({ ...withPage, nameChosen: false, nameChoices: [{ kind: "account", aliasId: null, label: "Grace Example" }] });

    await userEvent.click(screen.getByRole("checkbox", { name: /Show my profile on the web/ }));

    expect(await screen.findByText(/Choose the name your profile shows first, under/)).toBeInTheDocument();
    expect(screen.getByLabelText("Name shown")).toHaveDisplayValue("Choose a name…");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("says what is missing before it can go on: the address, then the name", () => {
    const { unmount } = renderPanel(noPage);
    expect(screen.getByText("Choose your address first. Until then it stays off.")).toBeInTheDocument();
    unmount();

    renderPanel({ ...withPage, nameChosen: false, nameChoices: [] });
    expect(screen.getByText("Choose the name your profile shows first. Until then it stays off.")).toBeInTheDocument();
  });

  it("asks before turning a public page off, and does nothing if they cancel", async () => {
    vi.mocked(actions.setWriterProfileSwitch).mockResolvedValue({ success: true });
    renderPanel({ ...withPage, isPublic: true });

    await userEvent.click(screen.getByRole("checkbox", { name: /Show my profile on the web/ }));
    expect(await screen.findByRole("dialog")).toHaveAccessibleName("Turn off your profile?");
    expect(actions.setWriterProfileSwitch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(actions.setWriterProfileSwitch).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("checkbox", { name: /Show my profile on the web/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Turn off profile" }));
    await waitFor(() => expect(actions.setWriterProfileSwitch).toHaveBeenCalledWith(false));
  });

  it("links to a preview that only the member can open, and to the live page only when it is on", () => {
    const { unmount } = renderPanel(withPage);

    expect(screen.getByRole("link", { name: "View as a visitor" })).toHaveAttribute("href", WRITER_PREVIEW_PATH);
    expect(screen.queryByRole("link", { name: "Open your profile" })).not.toBeInTheDocument();
    unmount();

    renderPanel({ ...withPage, isPublic: true });
    expect(screen.getByRole("link", { name: "Open your profile" })).toHaveAttribute("href", "https://hub.example.test/w/ada-example");
  });

  describe("the name shown", () => {
    const pen = { kind: "alias", aliasId: "nalias_AAAAAAAAAAA1", label: "A. E. Pen" } as const;
    const account = { kind: "account", aliasId: null, label: "Grace Legalname" } as const;
    const display = { kind: "display", aliasId: null, label: "Ada Example" } as const;
    const nothingChosen = { ...withPage, nameChosen: false, publicBio: "Written for the web." };

    it("still offers the name on the account when there is no display name, labeled as such and never chosen for them", async () => {
      vi.mocked(actions.saveWriterProfileDetails).mockResolvedValue({ success: true });
      renderPanel({ ...nothingChosen, nameChoices: [account] });
      const select = screen.getByLabelText("Name shown");

      expect(select).toHaveDisplayValue("Choose a name…");
      expect(within(select).getByRole("option", { name: "Grace Legalname (the name on your account)" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save name" })).toBeDisabled();
      expect(screen.queryByText(/go to Identity|under Identity, or/)).not.toBeInTheDocument();

      await userEvent.selectOptions(select, "account");
      await userEvent.click(screen.getByRole("button", { name: "Save name" }));

      expect(actions.saveWriterProfileDetails).toHaveBeenCalledWith({ publicNameAliasId: null, useAccountName: true, bio: "Written for the web." });
      expect(await screen.findByText("Name saved.")).toBeInTheDocument();
      expect(onChanged).toHaveBeenCalled();
    });

    it("saves one pen name the member marked public, keeping the separate bio", async () => {
      vi.mocked(actions.saveWriterProfileDetails).mockResolvedValue({ success: true });
      renderPanel({ ...nothingChosen, nameChoices: [pen, account] });

      await userEvent.selectOptions(screen.getByLabelText("Name shown"), "nalias_AAAAAAAAAAA1");
      await userEvent.click(screen.getByRole("button", { name: "Save name" }));

      expect(actions.saveWriterProfileDetails).toHaveBeenCalledWith({ publicNameAliasId: "nalias_AAAAAAAAAAA1", useAccountName: false, bio: "Written for the web." });
    });

    it("starts on the display name when there is one, and saves going back to it", async () => {
      vi.mocked(actions.saveWriterProfileDetails).mockResolvedValue({ success: true });
      renderPanel({ ...withPage, publicNameAliasId: pen.aliasId, nameChoices: [display, pen, account] });
      const select = screen.getByLabelText("Name shown");
      expect(select).toHaveDisplayValue("A. E. Pen (pen name)");

      await userEvent.selectOptions(select, "display");
      await userEvent.click(screen.getByRole("button", { name: "Save name" }));

      expect(actions.saveWriterProfileDetails).toHaveBeenCalledWith({ publicNameAliasId: null, useAccountName: false, bio: "" });
      expect(screen.getByText(/Your profile would be headed .*Ada Example/)).toBeInTheDocument();
    });

    it("adds a pen name right there, selects it, and does not save it as the name until they say so", async () => {
      vi.mocked(actions.addProfilePenName).mockResolvedValue({ success: true, aliasId: "nalias_AAAAAAAAAAA1" });
      const { rerender } = renderPanel({ ...nothingChosen, nameChoices: [account] });
      onChanged.mockImplementationOnce(async () => rerender(<WriterProfilePanel settings={{ ...nothingChosen, nameChoices: [pen, account] }} onChanged={onChanged} />));

      await userEvent.type(screen.getByLabelText("Add a pen name"), "  A. E. Pen ");
      await userEvent.click(screen.getByRole("button", { name: "Add pen name" }));

      expect(actions.addProfilePenName).toHaveBeenCalledWith("  A. E. Pen ");
      expect(await screen.findByText(/Pen name added/)).toBeInTheDocument();
      await waitFor(() => expect(screen.getByLabelText("Name shown")).toHaveDisplayValue("A. E. Pen (pen name)"));
      expect(screen.getByLabelText("Add a pen name")).toHaveValue("");
      expect(actions.saveWriterProfileDetails).not.toHaveBeenCalled();
    });

    it("shows why a pen name could not be added", async () => {
      vi.mocked(actions.addProfilePenName).mockResolvedValue({ error: "Another member already uses that name." });
      renderPanel({ ...nothingChosen, nameChoices: [account] });

      await userEvent.type(screen.getByLabelText("Add a pen name"), "Taken");
      await userEvent.click(screen.getByRole("button", { name: "Add pen name" }));

      expect(await screen.findByText("Another member already uses that name.")).toBeInTheDocument();
      expect(onChanged).not.toHaveBeenCalled();
    });

    it("keeps Add pen name off until something is typed, and shows the server's error when saving the name fails", async () => {
      vi.mocked(actions.saveWriterProfileDetails).mockResolvedValue({ error: "That name is not one of your pen names marked for your profile." });
      renderPanel({ ...nothingChosen, nameChoices: [pen] });
      expect(screen.getByRole("button", { name: "Add pen name" })).toBeDisabled();

      await userEvent.selectOptions(screen.getByLabelText("Name shown"), "nalias_AAAAAAAAAAA1");
      await userEvent.click(screen.getByRole("button", { name: "Save name" }));

      expect(await screen.findByText("That name is not one of your pen names marked for your profile.")).toBeInTheDocument();
    });
  });
});
