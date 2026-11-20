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
  hasPage: false,
  handle: null,
  isPublic: false,
  publicNameAliasId: null,
  showPhoto: false,
  bio: "",
  nameChoices: [{ aliasId: null, label: "Ada Example" }],
  photoAvailable: true,
  suggestedHandle: "ada-example",
  addressPrefix: "hub.example.test/w/",
  usingAccountName: false,
  pageUrl: null,
  previewPath: WRITER_PREVIEW_PATH,
};
const withPage: actions.WriterPageSettings = { ...noPage, hasPage: true, handle: "ada-example", pageUrl: "https://hub.example.test/w/ada-example" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(actions.loadHandleStatus).mockResolvedValue({ status: "available" });
});

describe("WriterPagePanel", () => {
  it("says what becomes public, calmly, and that it is off until switched on", async () => {
    vi.mocked(actions.getWriterPageSettings).mockResolvedValue(noPage);
    render(<WriterPagePanel />);

    expect(await screen.findByRole("heading", { name: "Your page on the web" })).toBeInTheDocument();
    expect(screen.getByText(/anyone can open without signing in/)).toBeInTheDocument();
    expect(screen.getByText(/not your email, your writing or your prickles/)).toBeInTheDocument();
    expect(screen.getByText(/stays off until you switch it on/)).toBeInTheDocument();
  });

  it("starts with an address made from the name, and shows only the address step until one is saved", async () => {
    vi.mocked(actions.getWriterPageSettings).mockResolvedValue(noPage);
    render(<WriterPagePanel />);

    expect(await screen.findByLabelText("Your address")).toHaveValue("ada-example");
    expect(screen.getByText("hub.example.test/w/")).toBeInTheDocument();
    expect(screen.queryByLabelText("Bio")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Show my page/ })).not.toBeInTheDocument();
  });

  it("checks an address as they type, and saves it once it is free", async () => {
    vi.mocked(actions.getWriterPageSettings).mockResolvedValue(noPage);
    vi.mocked(actions.claimWriterHandle).mockResolvedValue({ success: true, handle: "ada-writes", changed: false });
    render(<WriterPagePanel />);
    const input = await screen.findByLabelText("Your address");

    await userEvent.clear(input);
    await userEvent.type(input, "Ada-Writes");

    expect(await screen.findByText("That address is free.")).toBeInTheDocument();
    expect(actions.loadHandleStatus).toHaveBeenLastCalledWith("ada-writes");
    await userEvent.click(screen.getByRole("button", { name: "Save address" }));

    expect(actions.claimWriterHandle).toHaveBeenCalledWith("Ada-Writes");
    expect(await screen.findByText(/Address saved. Your page is still off/)).toBeInTheDocument();
  });

  it("refuses a handle that cannot be one at once, without asking the server", async () => {
    vi.mocked(actions.getWriterPageSettings).mockResolvedValue(noPage);
    render(<WriterPagePanel />);
    const input = await screen.findByLabelText("Your address");

    await userEvent.clear(input);
    await userEvent.type(input, "ada example");

    expect(await screen.findByText(/lowercase letters and numbers/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save address" })).toBeDisabled();
    expect(actions.loadHandleStatus).not.toHaveBeenCalled();
  });

  it("says when an address is taken and keeps Save off", async () => {
    vi.mocked(actions.getWriterPageSettings).mockResolvedValue(noPage);
    vi.mocked(actions.loadHandleStatus).mockResolvedValue({ status: "unavailable", message: "Someone already uses that address. Choose another." });
    render(<WriterPagePanel />);
    const input = await screen.findByLabelText("Your address");

    await userEvent.clear(input);
    await userEvent.type(input, "taken-name");

    expect(await screen.findByText("Someone already uses that address. Choose another.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save address" })).toBeDisabled();
  });

  it("asks before moving the page to a new address, and says what happens to the old one", async () => {
    vi.mocked(actions.getWriterPageSettings).mockResolvedValue(withPage);
    vi.mocked(actions.claimWriterHandle).mockResolvedValue({ success: true, handle: "ada-writes", changed: true });
    render(<WriterPagePanel />);
    const input = await screen.findByLabelText("Your address");
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
    vi.mocked(actions.getWriterPageSettings).mockResolvedValue(withPage);
    vi.mocked(actions.setWriterPageSwitch).mockResolvedValue({ success: true });
    render(<WriterPagePanel />);

    await userEvent.click(await screen.findByRole("checkbox", { name: /Show my page on the web/ }));
    expect(actions.setWriterPageSwitch).toHaveBeenCalledWith(true);
    expect(await screen.findByText("Your page is on. Anyone can open it.")).toBeInTheDocument();
  });

  it("asks before turning a public page off, and does nothing if they cancel", async () => {
    vi.mocked(actions.getWriterPageSettings).mockResolvedValue({ ...withPage, isPublic: true });
    vi.mocked(actions.setWriterPageSwitch).mockResolvedValue({ success: true });
    render(<WriterPagePanel />);

    await userEvent.click(await screen.findByRole("checkbox", { name: /Show my page on the web/ }));
    expect(await screen.findByRole("dialog")).toHaveAccessibleName("Turn off your page?");
    expect(actions.setWriterPageSwitch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(actions.setWriterPageSwitch).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("checkbox", { name: /Show my page on the web/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Turn off page" }));
    await waitFor(() => expect(actions.setWriterPageSwitch).toHaveBeenCalledWith(false));
  });

  it("links to a preview that only the member can open, and to the live page only when it is on", async () => {
    vi.mocked(actions.getWriterPageSettings).mockResolvedValue(withPage);
    const { unmount } = render(<WriterPagePanel />);

    expect(await screen.findByRole("link", { name: "View as a visitor" })).toHaveAttribute("href", WRITER_PREVIEW_PATH);
    expect(screen.queryByRole("link", { name: "Open your page" })).not.toBeInTheDocument();
    unmount();

    vi.mocked(actions.getWriterPageSettings).mockResolvedValue({ ...withPage, isPublic: true });
    render(<WriterPagePanel />);
    expect(await screen.findByRole("link", { name: "Open your page" })).toHaveAttribute("href", "https://hub.example.test/w/ada-example");
  });

  it("nudges them to check the name shown, and says when it is the name on the account", async () => {
    vi.mocked(actions.getWriterPageSettings).mockResolvedValue({ ...withPage, usingAccountName: true });
    render(<WriterPagePanel />);

    expect(await screen.findByText(/check it is the name you want on the open web/)).toBeInTheDocument();
    expect(screen.getByText(/name on your account/)).toBeInTheDocument();
  });

  it("saves the name, the photo choice and the bio together", async () => {
    vi.mocked(actions.getWriterPageSettings).mockResolvedValue({
      ...withPage,
      nameChoices: [
        { aliasId: null, label: "Ada Example" },
        { aliasId: "nalias_AAAAAAAAAAA1", label: "A. E. Pen" },
      ],
    });
    vi.mocked(actions.saveWriterPageDetails).mockResolvedValue({ success: true });
    render(<WriterPagePanel />);

    await userEvent.selectOptions(await screen.findByLabelText("Name shown"), "nalias_AAAAAAAAAAA1");
    await userEvent.click(screen.getByRole("checkbox", { name: /Show my photo/ }));
    await userEvent.type(screen.getByLabelText("Bio"), "I write cozy mysteries.");
    await userEvent.click(screen.getByRole("button", { name: "Save page details" }));

    expect(actions.saveWriterPageDetails).toHaveBeenCalledWith({ publicNameAliasId: "nalias_AAAAAAAAAAA1", showPhoto: true, bio: "I write cozy mysteries." });
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("does not offer a photo that cannot be published, and shows an error from the server", async () => {
    vi.mocked(actions.getWriterPageSettings).mockResolvedValue({ ...withPage, photoAvailable: false });
    vi.mocked(actions.saveWriterPageDetails).mockResolvedValue({ error: "Keep your bio to 1000 characters or fewer." });
    render(<WriterPagePanel />);

    expect(await screen.findByRole("checkbox", { name: /Show my photo/ })).toBeDisabled();
    expect(screen.getByText(/no photo that can be shown on a public page/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save page details" }));
    expect(await screen.findByText("Keep your bio to 1000 characters or fewer.")).toBeInTheDocument();
  });

  it("shows the error when the settings cannot be loaded", async () => {
    vi.mocked(actions.getWriterPageSettings).mockResolvedValue({ error: "Not authenticated" });
    render(<WriterPagePanel />);
    expect(await screen.findByText("Not authenticated")).toBeInTheDocument();
  });
});
