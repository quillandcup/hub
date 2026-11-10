// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const m = vi.hoisted(() => ({ start: vi.fn(), search: vi.fn(), push: vi.fn() }));
vi.mock("@/app/(member)/chat/dm-actions", () => ({ startDirectMessage: m.start, searchDmCandidates: m.search }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push }) }));

import NewMessagePicker from "@/components/chat/NewMessagePicker";

const ADA = { id: "mbr_AAAAAAAAAAG1", name: "Ada", detail: "Ada Example" };

beforeEach(() => {
  m.start.mockReset();
  m.search.mockReset();
  m.push.mockReset();
  m.search.mockResolvedValue([ADA]);
});

async function findAda() {
  render(<NewMessagePicker pathname="/chat" />);
  await userEvent.click(screen.getByRole("button", { name: "New message" }));
  await userEvent.type(screen.getByRole("combobox", { name: "Find a member" }), "ada");
  return screen.findByText("Ada");
}

describe("NewMessagePicker", () => {
  it("is closed until the icon is clicked, then searches by what is typed", async () => {
    render(<NewMessagePicker pathname="/chat" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "New message" }));
    expect(screen.getByRole("dialog", { name: "New message" })).toBeInTheDocument();
    await userEvent.type(screen.getByRole("combobox", { name: "Find a member" }), "ada");
    expect(await screen.findByText("Ada Example")).toBeInTheDocument();
    expect(m.search).toHaveBeenLastCalledWith("ada", expect.anything());
  });

  it("opens the direct message with the chosen member", async () => {
    m.start.mockResolvedValue({ ok: true, channelId: "chn_AAAAAAAAAAC1" });
    await userEvent.click(await findAda());
    expect(m.start).toHaveBeenCalledWith(ADA.id);
    await vi.waitFor(() => expect(m.push).toHaveBeenCalledWith("/chat/chn_AAAAAAAAAAC1"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows why it could not open and stays put", async () => {
    m.start.mockResolvedValue({ ok: false, error: "They haven't connected Slack to the Hub yet." });
    await userEvent.click(await findAda());
    expect(await screen.findByRole("alert")).toHaveTextContent("They haven't connected Slack");
    expect(m.push).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("disables the search while opening", async () => {
    let finish: (r: unknown) => void = () => {};
    m.start.mockReturnValue(new Promise((r) => (finish = r)));
    await userEvent.click(await findAda());
    expect(await screen.findByText("Opening…")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Find a member" })).toBeDisabled();
    finish({ ok: false, error: "No." });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("closes on Escape and on a click outside", async () => {
    render(
      <div>
        <p>elsewhere</p>
        <NewMessagePicker pathname="/chat" />
      </div>,
    );
    const open = () => userEvent.click(screen.getByRole("button", { name: "New message" }));
    await open();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await open();
    await userEvent.click(screen.getByText("elsewhere"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes when another conversation opens", async () => {
    const { rerender } = render(<NewMessagePicker pathname="/chat" />);
    await userEvent.click(screen.getByRole("button", { name: "New message" }));
    rerender(<NewMessagePicker pathname="/chat/chn_AAAAAAAAAAC1" />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
