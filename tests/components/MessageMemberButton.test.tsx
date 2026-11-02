// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const m = vi.hoisted(() => ({ start: vi.fn(), push: vi.fn() }));
vi.mock("@/app/(member)/chat/dm-actions", () => ({ startDirectMessage: m.start }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push }) }));

import MessageMemberButton from "@/components/chat/MessageMemberButton";

beforeEach(() => {
  m.start.mockReset();
  m.push.mockReset();
});

describe("MessageMemberButton", () => {
  it("opens the conversation in chat", async () => {
    m.start.mockResolvedValue({ ok: true, channelId: "chn_AAAAAAAAAAC1" });
    render(<MessageMemberButton memberId="mbr_AAAAAAAAAAG1" />);
    await userEvent.click(screen.getByRole("button", { name: "Message" }));
    expect(m.start).toHaveBeenCalledWith("mbr_AAAAAAAAAAG1");
    await vi.waitFor(() => expect(m.push).toHaveBeenCalledWith("/chat/chn_AAAAAAAAAAC1"));
  });

  it("shows what went wrong and stays on the page", async () => {
    m.start.mockResolvedValue({ ok: false, error: "You can't message that person." });
    render(<MessageMemberButton memberId="mbr_AAAAAAAAAAG1" />);
    await userEvent.click(screen.getByRole("button", { name: "Message" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You can't message that person.");
    expect(m.push).not.toHaveBeenCalled();
  });
});
