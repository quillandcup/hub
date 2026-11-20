// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WriterPagePanel } from "@/app/(member)/settings/WriterPagePanel";
import * as actions from "@/app/(member)/settings/writerPageActions";
import { WRITER_PROFILES } from "@/lib/config";
import { WRITER_PREVIEW_PATH } from "@/lib/writer-profile";

vi.mock("@/app/(member)/settings/writerPageActions", () => ({
  getWriterPageSettings: vi.fn(),
  loadHandleStatus: vi.fn(),
  claimWriterHandle: vi.fn(),
  setWriterPageSwitch: vi.fn(),
  saveWriterPageDetails: vi.fn(),
}));

const noPage: actions.WriterPageSettings = {
  available: true,
  hasPage: false,
  handle: null,
  isPublic: false,
  publicNameAliasId: null,
  publicBio: "",
  nameChosen: true,
  nameChoices: [{ aliasId: null, label: "Ada Example" }],
  photoAvailable: true,
  suggestedHandle: "ada-example",
  addressPrefix: "hub.example.test/w/",
  usingAccountName: false,
  pageUrl: null,
  previewPath: WRITER_PREVIEW_PATH,
};
const withPage: actions.WriterPageSettings = { ...noPage, hasPage: true, handle: "ada-example", pageUrl: "https://hub.example.test/w/ada-example" };

const onChanged = vi.fn(async () => {});
const renderPanel = (settings: actions.WriterPageSettings) => render(<WriterPagePanel settings={settings} onChanged={onChanged} />);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(actions.loadHandleStatus).mockResolvedValue({ status: "available" });
});

describe("WriterPagePanel", () => {
  it("says what becomes public, calmly, that the items are chosen above, and that it is off until switched on", () => {
    renderPanel(noPage);

    expect(screen.getByRole("heading", { name: "Your writer page on the web" })).toBeInTheDocument();
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
    expect(await screen.findByText(/Address saved. Next, choose the name for your page/)).toBeInTheDocument();
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
    expect(dialog).toHaveAccessibleName("Change your page address?");
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
    vi.mocked(actions.setWriterPageSwitch).mockResolvedValue({ success: true });
    renderPanel(withPage);

    await userEvent.click(screen.getByRole("checkbox", { name: /Show my page on the web/ }));
    expect(actions.setWriterPageSwitch).toHaveBeenCalledWith(true);
    expect(await screen.findByText("Your page is on. Anyone can open it.")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it("shows the server's reason when the switch is refused, as a plain message", async () => {
    vi.mocked(actions.setWriterPageSwitch).mockResolvedValue({ error: "Choose the name for your page first: set a display name under Identity, or pick a pen name for the page." });
    renderPanel(withPage);

    await userEvent.click(screen.getByRole("checkbox", { name: /Show my page on the web/ }));

    expect(await screen.findByText(/Choose the name for your page first/)).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("says what is missing before it can go on: the address, then the name", () => {
    const { unmount } = renderPanel(noPage);
    expect(screen.getByText("Choose your address first. Until then it stays off.")).toBeInTheDocument();
    unmount();

    renderPanel({ ...withPage, nameChosen: false, nameChoices: [] });
    expect(screen.getByText("Choose the name for your page first. Until then it stays off.")).toBeInTheDocument();
  });

  it("asks before turning a public page off, and does nothing if they cancel", async () => {
    vi.mocked(actions.setWriterPageSwitch).mockResolvedValue({ success: true });
    renderPanel({ ...withPage, isPublic: true });

    await userEvent.click(screen.getByRole("checkbox", { name: /Show my page on the web/ }));
    expect(await screen.findByRole("dialog")).toHaveAccessibleName("Turn off your page?");
    expect(actions.setWriterPageSwitch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(actions.setWriterPageSwitch).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("checkbox", { name: /Show my page on the web/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Turn off page" }));
    await waitFor(() => expect(actions.setWriterPageSwitch).toHaveBeenCalledWith(false));
  });

  it("links to a preview that only the member can open, and to the live page only when it is on", () => {
    const { unmount } = renderPanel(withPage);

    expect(screen.getByRole("link", { name: "View as a visitor" })).toHaveAttribute("href", WRITER_PREVIEW_PATH);
    expect(screen.queryByRole("link", { name: "Open your page" })).not.toBeInTheDocument();
    unmount();

    renderPanel({ ...withPage, isPublic: true });
    expect(screen.getByRole("link", { name: "Open your page" })).toHaveAttribute("href", "https://hub.example.test/w/ada-example");
  });

  it("asks which name to show, with nothing chosen yet, and saves the name keeping the separate bio", async () => {
    vi.mocked(actions.saveWriterPageDetails).mockResolvedValue({ success: true });
    renderPanel({
      ...withPage,
      nameChosen: false,
      publicBio: "Written for the web.",
      nameChoices: [{ aliasId: "nalias_AAAAAAAAAAA1", label: "A. E. Pen" }],
    });
    const select = screen.getByLabelText("Name shown");
    expect(select).toHaveDisplayValue("Choose a name…");
    expect(screen.getByRole("button", { name: "Save name" })).toBeDisabled();

    await userEvent.selectOptions(select, "nalias_AAAAAAAAAAA1");
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));

    expect(actions.saveWriterPageDetails).toHaveBeenCalledWith({ publicNameAliasId: "nalias_AAAAAAAAAAA1", bio: "Written for the web." });
    expect(await screen.findByText("Name saved.")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it("nudges them to check the name shown, and never offers the name on the account when there is no display name", () => {
    const { unmount } = renderPanel(withPage);
    expect(screen.getByText(/Your page would be headed .*Ada Example/)).toBeInTheDocument();
    expect(screen.getByText(/Take a moment to check it is the name you want on the open web/)).toBeInTheDocument();
    unmount();

    renderPanel({ ...withPage, nameChosen: false, usingAccountName: true, nameChoices: [] });
    expect(screen.getByText(/never uses the name on your account unless you pick it/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save name" })).toBeDisabled();
  });

  it("shows an error from the server when saving the name fails", async () => {
    vi.mocked(actions.saveWriterPageDetails).mockResolvedValue({ error: "That name is not one of your pen names marked for your page." });
    renderPanel({ ...withPage, nameChosen: false, nameChoices: [{ aliasId: "nalias_AAAAAAAAAAA1", label: "A. E. Pen" }] });

    await userEvent.selectOptions(screen.getByLabelText("Name shown"), "nalias_AAAAAAAAAAA1");
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));

    expect(await screen.findByText("That name is not one of your pen names marked for your page.")).toBeInTheDocument();
  });
});
