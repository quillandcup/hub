// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
vi.mock("@/app/(member)/chat/mention-actions", () => ({ suggestMentions: vi.fn(), suggestCustomEmoji: vi.fn() }));
import { suggestCustomEmoji, suggestMentions } from "@/app/(member)/chat/mention-actions";
import MentionTextarea from "@/components/chat/MentionTextarea";

const ANIA = { label: "@Ania Ray", token: "<@U1>", photoUrl: null };
const tokensRef = { current: new Map<string, string>() };

function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <MentionTextarea channelId="c1" aria-label="Message" value={value} onValueChange={setValue} tokens={tokensRef} />;
}
const box = () => screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;

beforeEach(() => {
  vi.mocked(suggestMentions).mockReset();
  vi.mocked(suggestMentions).mockResolvedValue([]);
  vi.mocked(suggestCustomEmoji).mockReset();
  vi.mocked(suggestCustomEmoji).mockResolvedValue([]);
  tokensRef.current = new Map();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MentionTextarea text conveniences", () => {
  it("turns an emoticon into an emoji when a space follows", async () => {
    render(<Harness />);
    await userEvent.setup().type(box(), "ok :) ");
    expect(box().value).toBe("ok 🙂 ");
  });

  it("grows to fit its text up to a maximum, then scrolls", () => {
    vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockReturnValue(100);
    render(<Harness initial="a" />);
    expect(box().style.height).toBe("100px");
    cleanup();
    vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockReturnValue(900);
    render(<Harness initial="long" />);
    expect(box().style.height).toBe("240px");
    expect(box().style.overflowY).toBe("auto");
  });

  it("turns pasted full names into mentions and leaves unknown ones as text", async () => {
    vi.mocked(suggestMentions).mockImplementation(async (_c, _t, q) => (q === "Ania Ray" ? [ANIA] : []));
    render(<Harness />);
    const user = userEvent.setup();
    box().focus();
    await user.paste("@Ania Ray @Nobody");
    await waitFor(() => expect(tokensRef.current.get("@Ania Ray")).toBe("<@U1>"));
    expect(box().value).toBe("@Ania Ray @Nobody");
    expect(tokensRef.current.size).toBe(1);
  });
});
