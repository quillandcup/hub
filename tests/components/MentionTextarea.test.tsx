// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { cleanup, render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
import { track } from "@/lib/analytics/client";
vi.mock("@/app/(member)/chat/mention-actions", () => ({ suggestMentions: vi.fn(), suggestCustomEmoji: vi.fn() }));
import { suggestCustomEmoji, suggestMentions, type MentionSuggestion } from "@/app/(member)/chat/mention-actions";
import MentionTextarea from "@/components/chat/MentionTextarea";

const ANIA = { label: "@Ania Ray", token: "<@U1>", photoUrl: null };
const SAM = { label: "@Sam Lee", token: "<@U2>", photoUrl: null };
const SAM_TOO = { label: "@Sam Lee", token: "<@U3>", photoUrl: null };
const GENERAL = { label: "#general", token: "<#C1>", photoUrl: null };

const tokensRef = { current: new Map<string, string>() };
let keyed: string[];
function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <MentionTextarea
      channelId="c1"
      aria-label="Message"
      value={value}
      onValueChange={setValue}
      tokens={tokensRef}
      onKeyDown={(e) => keyed.push(e.key)}
    />
  );
}

const box = () => screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
const type = async (text: string) => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await user.type(box(), text);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  return user;
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(suggestMentions).mockReset();
  vi.mocked(suggestMentions).mockResolvedValue([]);
  vi.mocked(suggestCustomEmoji).mockReset();
  vi.mocked(suggestCustomEmoji).mockResolvedValue([]);
  keyed = [];
  tokensRef.current = new Map();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("MentionTextarea", () => {
  it("offers people after @, and writes the picked name into the text with its Slack markup remembered", async () => {
    vi.mocked(suggestMentions).mockResolvedValue([ANIA, SAM]);
    render(<Harness />);

    const user = await type("hi @an");
    expect(suggestMentions).toHaveBeenLastCalledWith("c1", "@", "an");
    expect(await screen.findByRole("listbox", { name: "People" })).toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: /Ania Ray/ }));
    expect(box()).toHaveValue("hi @Ania Ray ");
    expect(tokensRef.current.get("@Ania Ray")).toBe("<@U1>");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("offers channels after #", async () => {
    vi.mocked(suggestMentions).mockResolvedValue([GENERAL]);
    render(<Harness />);
    const user = await type("see #gen");
    expect(suggestMentions).toHaveBeenLastCalledWith("c1", "#", "gen");
    await user.click(await screen.findByRole("option", { name: "#general" }));
    expect(box()).toHaveValue("see #general ");
    expect(tokensRef.current.get("#general")).toBe("<#C1>");
  });

  it("moves with the arrow keys, picks with Enter, and keeps Enter from reaching the owner while choices show", async () => {
    vi.mocked(suggestMentions).mockResolvedValue([ANIA, SAM]);
    render(<Harness />);
    const user = await type("@");
    await screen.findByRole("listbox");

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: /Sam Lee/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: /Ania Ray/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowUp}");
    await user.keyboard("{Enter}");
    expect(box()).toHaveValue("@Sam Lee ");
    expect(keyed).not.toContain("Enter");

    await user.keyboard("{Enter}");
    expect(keyed).toContain("Enter");
  });

  it("picks with Tab, closes with Escape without passing it on, and passes other keys on", async () => {
    vi.mocked(suggestMentions).mockResolvedValue([ANIA]);
    render(<Harness />);
    const user = await type("@a");
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(keyed).not.toContain("Escape");

    await user.keyboard("{Escape}");
    expect(keyed).toContain("Escape");

    await user.clear(box());
    await type("@a");
    await screen.findByRole("listbox");
    await user.keyboard("{Tab}");
    expect(box()).toHaveValue("@Ania Ray ");
  });

  it("only looks at @ and # at the start of a word, and offers nothing for a search that finds nobody", async () => {
    render(<Harness />);
    await type("mail me@home");
    expect(suggestMentions).not.toHaveBeenCalled();

    await user_clear();
    await type("@zzz");
    expect(suggestMentions).toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes when the box loses focus, and survives a failed search", async () => {
    vi.mocked(suggestMentions).mockRejectedValueOnce(new Error("offline"));
    render(<Harness />);
    await type("@a");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    vi.mocked(suggestMentions).mockResolvedValue([ANIA]);
    await user_clear();
    await type("@an");
    await screen.findByRole("listbox");
    act(() => box().blur());
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });

  it("tells two people with the same name apart so each keeps its own markup", async () => {
    vi.mocked(suggestMentions).mockResolvedValueOnce([SAM]).mockResolvedValueOnce([SAM_TOO]);
    render(<Harness />);
    let user = await type("@sam");
    await user.click(await screen.findByRole("option", { name: /Sam Lee/ }));
    user = await type("and @sam");
    await user.click(await screen.findByRole("option", { name: /Sam Lee/ }));
    expect(box()).toHaveValue("@Sam Lee and @Sam Lee (2) ");
    expect(tokensRef.current.get("@Sam Lee")).toBe("<@U2>");
    expect(tokensRef.current.get("@Sam Lee (2)")).toBe("<@U3>");
  });

  it("ignores an answer to something typed since", async () => {
    let resolveFirst: (v: MentionSuggestion[]) => void = () => {};
    vi.mocked(suggestMentions)
      .mockImplementationOnce(() => new Promise<MentionSuggestion[]>((r) => (resolveFirst = r)))
      .mockResolvedValue([]);
    render(<Harness />);
    await type("@a");
    await type("n");
    await act(async () => resolveFirst([ANIA]));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  describe("emoji after a colon", () => {
    it("offers matching emoji after :pr, writes the picked :shortcode: and never asks for people", async () => {
      render(<Harness />);
      const user = await type("thanks :pray");
      const list = await screen.findByRole("listbox", { name: "Emoji" });
      expect(list).toBeInTheDocument();
      expect(screen.getAllByRole("option")[0]).toHaveTextContent(":pray:");
      expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
      expect(suggestMentions).not.toHaveBeenCalled();
      expect(suggestCustomEmoji).toHaveBeenLastCalledWith("pray");

      await user.keyboard("{ArrowDown}{ArrowUp}{Enter}");
      expect(box()).toHaveValue("thanks :pray: ");
      expect(track).toHaveBeenCalledWith("chat_emoji_suggestion_picked", { custom: false, via: "keyboard" });
      expect(keyed).not.toContain("Enter");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("lists a custom emoji ahead of other standard ones and draws its image", async () => {
      vi.mocked(suggestCustomEmoji).mockResolvedValue([{ name: "pray-hedgie", emoji: { url: "https://example.com/pray.png" } }]);
      render(<Harness />);
      const user = await type(":pray");
      const options = await screen.findAllByRole("option");
      expect(options[0]).toHaveTextContent(":pray:");
      expect(options[1]).toHaveTextContent(":pray-hedgie:");
      expect(options[1].querySelector("img")).toHaveAttribute("src", "https://example.com/pray.png");
      await user.click(options[1]);
      expect(box()).toHaveValue(":pray-hedgie: ");
      expect(track).toHaveBeenCalledWith("chat_emoji_suggestion_picked", { custom: true, via: "pointer" });
    });

    it("waits for two characters and a word start, and Enter sends when nothing matches", async () => {
      render(<Harness />);
      await type("at 10:30 or :p");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(suggestCustomEmoji).not.toHaveBeenCalled();

      await user_clear();
      const user = await type(":zzzqqq");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      await user.keyboard("{Enter}");
      expect(keyed).toContain("Enter");
    });

    it("closes with Escape, and a pick in the middle of the text keeps what follows", async () => {
      render(<Harness initial="see  now" />);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      box().focus();
      box().setSelectionRange(4, 4);
      await user.keyboard(":tada");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      await screen.findByRole("listbox", { name: "Emoji" });
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      await user.keyboard("{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}:tada");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      await user.keyboard("{Tab}");
      expect(box()).toHaveValue("see :tada:  now");
    });
  });
});

async function user_clear() {
  await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).clear(box());
}
