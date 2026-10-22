// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(member)/chat/actions", () => ({ toggleChatReaction: vi.fn() }));
import MessageActions from "@/components/chat/MessageActions";

const renderActions = () =>
  render(<MessageActions channelId="c1" messageId="m1" body="hello" custom={{}} canReact canReply />);

describe("MessageActions tooltips", () => {
  it("uses a styled tooltip, not the browser's title tooltip, on each action", () => {
    renderActions();
    for (const name of ["Add reaction…", "Reply in thread", "More actions"]) {
      const control = screen.getByRole(name === "Reply in thread" ? "link" : "button", { name });
      expect(control).not.toHaveAttribute("title");
      expect(control).toHaveClass("group/tip");
    }
  });

  it("labels each tooltip and hides it from assistive tech", () => {
    renderActions();
    for (const text of ["Add reaction", "Reply in thread", "More actions"]) {
      const tip = screen.getByText(text, { selector: "span[aria-hidden]" });
      expect(tip).toHaveClass("hidden", "group-hover/tip:block", "group-focus-visible/tip:block");
    }
  });
});
