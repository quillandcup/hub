// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(member)/chat/actions", () => ({ toggleChatReaction: vi.fn() }));
vi.mock("emojibase-data/en/data.json", () => {
  throw new Error("chunk failed to load");
});
import EmojiPicker from "@/components/chat/EmojiPicker";

describe("EmojiPicker when the emoji data fails to load", () => {
  it("says so instead of staying empty", async () => {
    render(<EmojiPicker custom={{}} onPick={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the emoji");
  });
});
