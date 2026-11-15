// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const press = vi.hoisted(() => vi.fn());
vi.mock("@/app/(member)/chat/dm-controls-actions", () => ({ pressChatDmControl: press }));
vi.mock("@/lib/chat/list-events", () => ({ pokeChat: vi.fn(() => true) }));

import MessageUnfurls from "@/components/chat/MessageUnfurls";
import ChatText, { type ChatTextContext } from "@/components/chat/ChatText";
import { parseUnfurls } from "@/lib/chat/unfurls";
import { buildCheckinBlocks, buildCheckoutBlocks } from "@/lib/prickle-checkin-dms";

const ctx: ChatTextContext = { userNames: {}, userMembers: {}, channelIds: {}, channelNames: {}, customEmoji: {} };
const PRICKLE = "prkl_AAAAAAAAAAA1";
const unfurlsOf = (blocks: unknown[]) => parseUnfurls({ blocks }, { bot: true, body: "" }).unfurls;
const draw = (blocks: unknown[], dm = true) =>
  render(<MessageUnfurls unfurls={unfurlsOf(blocks)} ctx={ctx} permalink="https://example.slack.test/p1" dm={dm ? { channelId: "chn_AAAAAAAAAAA1", messageId: "msg_AAAAAAAAAAA1" } : undefined} />);

beforeEach(() => press.mockReset());

describe("DM controls in Hub chat", () => {
  it("sends a scale button's press and shows the blocks that come back", async () => {
    const after = buildCheckinBlocks(PRICKLE, "Midnight Crew", { pleasantBefore: 2, skipped: [] } as never);
    press.mockResolvedValue({ ok: true, unfurl: unfurlsOf(after)[0] });
    draw(buildCheckinBlocks(PRICKLE, "Midnight Crew", null));
    const buttons = within(screen.getAllByRole("group")[0]).getAllByRole("button");
    expect(buttons[1]).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(buttons[1]);
    expect(press).toHaveBeenCalledWith({
      channelId: "chn_AAAAAAAAAAA1",
      messageId: "msg_AAAAAAAAAAA1",
      blockId: `prickle_checkin:${PRICKLE}:pleasant_before`,
      actionId: "prickle_checkin_answer:2",
      value: "2",
    });
    await waitFor(() => expect(within(screen.getAllByRole("group")[0]).getAllByRole("button")[1]).toHaveAttribute("aria-pressed", "true"));
  });

  it("shows the refusal when the press fails", async () => {
    press.mockResolvedValue({ ok: false, error: "That message isn't available." });
    draw(buildCheckinBlocks(PRICKLE, "Midnight Crew", null));
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That message isn't available.");
  });

  it("picks from the list by typing, and sends the option", async () => {
    press.mockResolvedValue({ ok: false, error: "x" });
    draw(buildCheckinBlocks(PRICKLE, "Midnight Crew", null));
    const box = screen.getByRole("combobox", { name: /intention/i });
    await userEvent.click(box);
    await userEvent.click(await screen.findByText(/Skip this question/));
    expect(press).toHaveBeenCalledWith(expect.objectContaining({ blockId: `prickle_checkin:${PRICKLE}:need`, actionId: "prickle_checkin_answer", selectedValue: "skip" }));
  });

  it("sends the number typed on Enter, not before", async () => {
    press.mockResolvedValue({ ok: false, error: "x" });
    draw(buildCheckoutBlocks(PRICKLE, "Pop-Up Prickle", null, [{ projectId: "wpr_AAAAAAAAAAA1", projectTitle: "My Novel", measure: "words" } as never]));
    const input = screen.getByRole("spinbutton");
    await userEvent.type(input, "250");
    expect(press).not.toHaveBeenCalled();
    await userEvent.type(input, "{Enter}");
    expect(press).toHaveBeenCalledWith(expect.objectContaining({ actionId: "writing_quick_log", value: "250" }));
  });

  it("without a scope (not the viewer's DM, or sudo) draws no working control, only the way to Slack", () => {
    draw(buildCheckinBlocks(PRICKLE, "Midnight Crew", null), false);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getAllByRole("link", { name: "Open in Slack" }).length).toBeGreaterThan(0);
  });
});

describe("bold in Slack text", () => {
  it("keeps a bold link bold and draws a bold name as strong", () => {
    const { container } = render(<ChatText body={"*<https://example.com/a|Title &amp; more>*\nSummary with *Midnight Crew*."} ctx={ctx} />);
    const link = screen.getByRole("link", { name: "Title & more" });
    expect(link.closest("strong")).not.toBeNull();
    expect(link.closest("strong")?.className).toContain("[&_a]:font-bold");
    expect(container.querySelectorAll("strong")).toHaveLength(2);
  });
});
