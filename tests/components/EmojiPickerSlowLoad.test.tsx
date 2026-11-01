// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(member)/chat/actions", () => ({ toggleChatReaction: vi.fn() }));
vi.mock("emojibase-data/en/data.json", () => new Promise(() => {}));
import EmojiPicker from "@/components/chat/EmojiPicker";

describe("EmojiPicker while the emoji data is still loading", () => {
  it("shows no 'nothing matches' message for a search yet", async () => {
    render(<EmojiPicker custom={{}} onPick={vi.fn()} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Search emoji"), "zzz");
    expect(screen.queryByText(/No emoji match/)).not.toBeInTheDocument();
  });
});
