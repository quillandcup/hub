// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
import { track } from "@/lib/analytics/client";
vi.mock("@/app/(member)/chat/mention-actions", () => ({ suggestMentions: vi.fn(), suggestCustomEmoji: vi.fn() }));
import { suggestCustomEmoji, suggestMentions } from "@/app/(member)/chat/mention-actions";
import MessageBox, { MAX_BOX_HEIGHT_PX, type MessageBoxHandle } from "@/components/chat/MessageBox";
import { linkAddress } from "@/components/chat/FormatToolbar";
import { boxUser, caretToEnd, flushEditor, messageBox, typeInto } from "../helpers/message-box";

const ANIA = { label: "@Ania Ray", token: "<@U1>", photoUrl: null };
const SAM = { label: "@Sam Lee", token: "<@U2>", photoUrl: null };
const SAM_TOO = { label: "@Sam Lee", token: "<@U3>", photoUrl: null };
const GENERAL = { label: "#general", token: "<#C1>", photoUrl: null };
const HEDGIE = { name: "pray-hedgie", emoji: { url: "https://emoji.example.test/pray-hedgie.png" } };

const tokensRef = { current: new Map<string, string>() };
let latest = "";
let keyed: string[];
const handle: { current: MessageBoxHandle | null } = { current: null };

function Harness({
  initial = "",
  ...props
}: { initial?: string } & Partial<React.ComponentProps<typeof MessageBox>>) {
  const [value, setValue] = useState(initial);
  return (
    <MessageBox
      channelId="c1"
      aria-label="Message"
      value={value}
      onValueChange={(next) => {
        latest = next;
        setValue(next);
      }}
      tokens={tokensRef}
      boxRef={handle}
      onKeyDown={(e) => keyed.push(e.key)}
      {...props}
    />
  );
}

/** Selects the whole text of the box, the way a drag or Ctrl+A would. */
const selectAll = async (box: HTMLElement) => {
  box.focus();
  const range = document.createRange();
  range.selectNodeContents(box);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
};

const mount = async (props: Parameters<typeof Harness>[0] = {}) => {
  latest = props.initial ?? "";
  render(<Harness {...props} />);
  return messageBox("Message");
};

beforeEach(() => {
  cleanup();
  vi.mocked(track).mockReset();
  vi.mocked(suggestMentions).mockReset();
  vi.mocked(suggestMentions).mockResolvedValue([]);
  vi.mocked(suggestCustomEmoji).mockReset();
  vi.mocked(suggestCustomEmoji).mockResolvedValue([]);
  keyed = [];
  latest = "";
  tokensRef.current = new Map();
  handle.current = null;
});

describe("MessageBox: people and channels", () => {
  it("offers people after @, and writes the picked name into the text with its Slack markup remembered", async () => {
    vi.mocked(suggestMentions).mockResolvedValue([ANIA, SAM]);
    const box = await mount();
    const user = boxUser();
    await typeInto(box, "hi @an", user);
    await waitFor(() => expect(suggestMentions).toHaveBeenLastCalledWith("c1", "@", "an"));
    expect(await screen.findByRole("listbox", { name: "People" })).toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: /Ania Ray/ }));
    expect(latest).toBe("hi @Ania Ray ");
    expect(tokensRef.current.get("@Ania Ray")).toBe("<@U1>");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("offers channels after #", async () => {
    vi.mocked(suggestMentions).mockResolvedValue([GENERAL]);
    const box = await mount();
    const user = boxUser();
    await typeInto(box, "see #gen", user);
    await user.click(await screen.findByRole("option", { name: "#general" }));
    expect(latest).toBe("see #general ");
    expect(tokensRef.current.get("#general")).toBe("<#C1>");
  });

  it("moves with the arrow keys, picks with Enter, and keeps Enter from reaching the owner while choices show", async () => {
    vi.mocked(suggestMentions).mockResolvedValue([ANIA, SAM]);
    const box = await mount();
    const user = boxUser();
    await typeInto(box, "@", user);
    await screen.findByRole("listbox");

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: /Sam Lee/ })).toHaveAttribute("aria-selected", "true");
    expect(box).toHaveAttribute("aria-activedescendant", screen.getByRole("option", { name: /Sam Lee/ }).id);
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: /Ania Ray/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowUp}");
    await user.keyboard("{Enter}");
    expect(latest).toBe("@Sam Lee ");
    expect(keyed).not.toContain("Enter");
    expect(box).not.toHaveAttribute("aria-activedescendant");

    await user.keyboard("{Enter}");
    expect(keyed).toContain("Enter");
  });

  it("picks with Tab, closes with Escape without passing it on, and passes other keys on", async () => {
    vi.mocked(suggestMentions).mockResolvedValue([ANIA]);
    const box = await mount();
    const user = boxUser();
    await typeInto(box, "@a", user);
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(keyed).not.toContain("Escape");

    await user.keyboard("{Escape}");
    expect(keyed).toContain("Escape");

    cleanup();
    const again = await mount();
    await typeInto(again, "@a", user);
    await screen.findByRole("listbox");
    await user.keyboard("{Tab}");
    expect(latest).toBe("@Ania Ray ");
  });

  it("only looks at @ and # at the start of a word, and offers nothing for a search that finds nobody", async () => {
    const box = await mount();
    await typeInto(box, "mail me@home");
    expect(suggestMentions).not.toHaveBeenCalled();

    await typeInto(box, " @zzz");
    await waitFor(() => expect(suggestMentions).toHaveBeenCalled());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes when the box loses focus, and survives a failed search", async () => {
    vi.mocked(suggestMentions).mockRejectedValueOnce(new Error("offline"));
    const box = await mount();
    await typeInto(box, "@a");
    await waitFor(() => expect(suggestMentions).toHaveBeenCalled());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    vi.mocked(suggestMentions).mockResolvedValue([ANIA]);
    await typeInto(box, "n");
    await screen.findByRole("listbox");
    act(() => box.blur());
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });

  it("tells two people with the same name apart so each keeps its own markup", async () => {
    vi.mocked(suggestMentions).mockResolvedValueOnce([SAM]).mockResolvedValueOnce([SAM_TOO]);
    const box = await mount();
    const user = boxUser();
    await typeInto(box, "@sam", user);
    await user.click(await screen.findByRole("option", { name: /Sam Lee/ }));
    await typeInto(box, "and @sam", user);
    await user.click(await screen.findByRole("option", { name: /Sam Lee/ }));
    expect(latest).toBe("@Sam Lee and @Sam Lee (2) ");
    expect(tokensRef.current.get("@Sam Lee")).toBe("<@U2>");
    expect(tokensRef.current.get("@Sam Lee (2)")).toBe("<@U3>");
  });

  it("ignores an answer to something typed since", async () => {
    let resolveFirst: (v: (typeof ANIA)[]) => void = () => {};
    vi.mocked(suggestMentions)
      .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
      .mockResolvedValue([]);
    const box = await mount();
    await typeInto(box, "@a");
    await waitFor(() => expect(suggestMentions).toHaveBeenCalledTimes(1));
    await typeInto(box, "n");
    await waitFor(() => expect(suggestMentions).toHaveBeenCalledTimes(2));
    await act(async () => resolveFirst([ANIA]));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("MessageBox: emoji after a colon", () => {
  it("offers matching emoji after :pr, inserts the emoji itself and never asks for people", async () => {
    const box = await mount();
    const user = boxUser();
    await typeInto(box, "thanks :pray", user);
    expect(await screen.findByRole("listbox", { name: "Emoji" })).toBeInTheDocument();
    expect(screen.getAllByRole("option")[0]).toHaveTextContent(":pray:");
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    expect(suggestMentions).not.toHaveBeenCalled();
    expect(suggestCustomEmoji).toHaveBeenLastCalledWith("pray");

    await user.keyboard("{ArrowDown}{ArrowUp}{Enter}");
    expect(latest).toBe("thanks \u{1F64F} ");
    expect(keyed).not.toContain("Enter");
    expect(track).toHaveBeenCalledWith("chat_emoji_suggestion_picked", { custom: false, via: "keyboard" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("lists a custom emoji ahead of other standard ones, and inserts it as its image, sent as :name:", async () => {
    vi.mocked(suggestCustomEmoji).mockResolvedValue([HEDGIE]);
    const box = await mount();
    const user = boxUser();
    await typeInto(box, ":pray", user);
    const options = await screen.findAllByRole("option");
    expect(options[0]).toHaveTextContent(":pray:");
    expect(options[1]).toHaveTextContent(":pray-hedgie:");
    expect(options[1].querySelector("img")).toHaveAttribute("src", HEDGIE.emoji.url);

    await user.click(options[1]);
    expect(latest).toBe(":pray-hedgie: ");
    // In the box it is the picture, not the letters.
    // (The editor adds an image of its own after an emoji at the end of a line, so the emoji is found by its text.)
    expect(box.querySelector('img[alt=":pray-hedgie:"]')).toHaveAttribute("src", HEDGIE.emoji.url);
    expect(box.textContent).not.toContain(":pray-hedgie:");
    expect(track).toHaveBeenCalledWith("chat_emoji_suggestion_picked", { custom: true, via: "pointer" });
  });

  it("waits for two characters and a word start, and Enter sends when nothing matches", async () => {
    const box = await mount();
    const user = boxUser();
    await typeInto(box, "at 10:30 or :p", user);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(suggestCustomEmoji).not.toHaveBeenCalled();

    cleanup();
    const again = await mount();
    await typeInto(again, "see :zzzqqq", user);
    await waitFor(() => expect(suggestCustomEmoji).toHaveBeenCalledWith("zzzqqq"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(keyed).toContain("Enter");
  });

  it("writes the text large while it is only emoji", async () => {
    const box = await mount();
    await typeInto(box, "\u{1F64F}");
    await waitFor(() => expect(box.parentElement!.parentElement!.className).toContain("!text-[2rem]"));
    await typeInto(box, " hi");
    await waitFor(() => expect(box.parentElement!.parentElement!.className).not.toContain("!text-[2rem]"));
  });

  it("shows a custom emoji already in the text as its image when the box is given the emoji", async () => {
    const box = await mount({ initial: "hi :pray-hedgie: :nope:", customEmoji: { "pray-hedgie": HEDGIE.emoji } });
    expect(box.querySelector('img[alt=":pray-hedgie:"]')).toHaveAttribute("src", HEDGIE.emoji.url);
    expect(box.textContent).toBe("hi  :nope:");
    expect(latest).toBe("hi :pray-hedgie: :nope:");
  });
});

describe("MessageBox: formatting", () => {
  it("formats the selection from the toolbar, lights the button while the caret is in that format, and reports it", async () => {
    const box = await mount({ initial: "say hello" });
    const user = boxUser();
    await selectAll(box);
    await user.click(screen.getByRole("button", { name: "Bold" }));
    expect(latest).toBe("*say hello*");
    expect(box.querySelector("strong")).toHaveTextContent("say hello");
    expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");
    expect(track).toHaveBeenCalledWith("chat_format_applied", { kind: "bold", via: "toolbar" });

    await user.click(screen.getByRole("button", { name: "Bold" }));
    expect(latest).toBe("say hello");
    expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "false");
  });

  it("has a button for each format, writing Slack's text for it", async () => {
    const user = boxUser();
    const expected: [string, string][] = [
      ["Italic", "_one_"],
      ["Strikethrough", "~one~"],
      ["Code", "`one`"],
      ["Quote", "> one"],
      ["Bulleted list", "• one"],
      ["Numbered list", "1. one"],
      ["Code block", "```\none\n```"],
    ];
    for (const [name, text] of expected) {
      cleanup();
      const box = await mount({ initial: "one" });
      await selectAll(box);
      await user.click(screen.getByRole("button", { name }));
      expect(latest, name).toBe(text);
    }
  });

  it("underlines from the toolbar and with Ctrl+U, written as <u>…</u>, and toggles it off", async () => {
    const box = await mount({ initial: "see this" });
    const user = boxUser();
    await selectAll(box);
    await user.click(screen.getByRole("button", { name: "Underline" }));
    expect(latest).toBe("<u>see this</u>");
    expect(box.querySelector("u")).toHaveTextContent("see this");
    expect(screen.getByRole("button", { name: "Underline" })).toHaveAttribute("aria-pressed", "true");
    expect(track).toHaveBeenCalledWith("chat_format_applied", { kind: "underline", via: "toolbar" });
    await user.keyboard("{Control>}u{/Control}");
    expect(latest).toBe("see this");
    await user.keyboard("{Control>}u{/Control}");
    expect(latest).toBe("<u>see this</u>");
    expect(track).toHaveBeenCalledWith("chat_format_applied", { kind: "underline", via: "shortcut" });
  });

  it("shows an underline already in the text, and takes it up from a message being edited", async () => {
    const box = await mount({ initial: "a <u>b</u> c" });
    expect(box.querySelector("u")).toHaveTextContent("b");
    expect(box.textContent).toBe("a b c");
    expect(latest).toBe("a <u>b</u> c");
  });

  it("formats with Ctrl+B, Ctrl+I and Ctrl+Shift+X, and records the shortcut", async () => {
    const box = await mount({ initial: "word" });
    const user = boxUser();
    await selectAll(box);
    await user.keyboard("{Control>}b{/Control}");
    expect(latest).toBe("*word*");
    await user.keyboard("{Control>}i{/Control}");
    expect(latest).toBe("*_word_*");
    await user.keyboard("{Control>}{Shift>}x{/Shift}{/Control}");
    expect(latest).toBe("*_~word~_*");
    expect(track).toHaveBeenCalledWith("chat_format_applied", { kind: "strike", via: "shortcut" });
  });

  it("formats as it is typed: *bold*, _italic_, ~strike~, a > quote, a - list and a 1. list", async () => {
    const box = await mount();
    const user = boxUser();
    await typeInto(box, "a *bold* b ", user);
    expect(box.querySelector("strong")).toHaveTextContent("bold");
    await typeInto(box, "_it_ ~gone~ ", user);
    expect(latest).toBe("a *bold* b _it_ ~gone~ ");

    cleanup();
    const quoted = await mount();
    await typeInto(quoted, "> said", user);
    expect(latest).toBe("> said");
    expect(quoted.querySelector("blockquote")).not.toBeNull();

    cleanup();
    const listed = await mount();
    await typeInto(listed, "- one{Enter}two{Enter}{Enter}after", user);
    expect(latest).toBe("• one\n• two\nafter");
  });

  it("starts a line on Shift+Enter, a list item on Enter inside a list, and sends on Ctrl+Enter from anywhere", async () => {
    const box = await mount();
    const user = boxUser();
    await typeInto(box, "one{Shift>}{Enter}{/Shift}two", user);
    expect(latest).toBe("one\ntwo");

    cleanup();
    keyed = [];
    const list = await mount({ initial: "• a" });
    await typeInto(list, "{Enter}b", user);
    expect(latest).toBe("• a\n• b");
    expect(keyed).not.toContain("Enter");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(keyed).toContain("Enter");
  });

  it("nests a list item with Tab and brings it back with Shift+Tab, written as indented lines, and shows nested lists from text", async () => {
    const box = await mount({ initial: "1. a\n2. b" });
    const user = boxUser();
    await caretToEnd(box);
    await user.keyboard("{Tab}");
    expect(latest).toBe("1. a\n  1. b");
    expect(box.querySelectorAll("ol ol")).toHaveLength(1);
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(latest).toBe("1. a\n2. b");

    cleanup();
    const nested = await mount({ initial: "• x <u>u</u>\n  • y\n    1. z" });
    expect(nested.querySelectorAll("ul ul ol")).toHaveLength(1);
    expect(latest).toBe("• x <u>u</u>\n  • y\n    1. z");
  });

  it("Backspace at the start of a list item brings it out one level, and out of the list from the first level, like Slack", async () => {
    const box = await mount({ initial: "• a\n  • bb\n    • cc" });
    const user = boxUser();
    const startOf = async (text: string) => {
      const node = [...box.querySelectorAll("p")].find((p) => p.textContent === text)!.firstChild as Text;
      const range = document.createRange();
      range.setStart(node, 0);
      range.collapse(true);
      box.focus();
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    };
    await startOf("cc");
    await user.keyboard("{Backspace}");
    expect(latest).toBe("• a\n  • bb\n  • cc");
    await startOf("cc");
    await user.keyboard("{Backspace}");
    expect(latest).toBe("• a\n  • bb\n• cc");
    await startOf("cc");
    await user.keyboard("{Backspace}");
    expect(latest).toBe("• a\n  • bb\ncc");
  });

  it("marks each list with its depth (for the marker Slack uses at that level) and won't nest a sixth level", async () => {
    const five = "• 0\n  • 1\n    • 2\n      • 3\n        • 4\n        • 5";
    const box = await mount({ initial: five });
    expect([...box.querySelectorAll("ul")].map((ul) => ul.getAttribute("data-list-depth"))).toEqual(["0", "1", "2", "3", "4"]);
    const user = boxUser();
    await caretToEnd(box);
    // "5" sits beside "4" (the fifth level); sinking it would make a sixth.
    await user.keyboard("{Tab}");
    expect(latest).toBe(five);
    expect(box.querySelector('[data-list-depth="5"]')).toBeNull();
  });

  it("links the selection from the toolbar with an address, checks the address, and unlinks", async () => {
    const box = await mount({ initial: "see the docs" });
    const user = boxUser();
    await selectAll(box);
    await user.click(screen.getByRole("button", { name: "Link" }));
    const address = screen.getByRole("textbox", { name: "Link address" });
    await user.type(address, "not an address{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("web or email address");
    await user.clear(address);
    await user.type(address, "example.test/docs{Enter}");
    expect(latest).toBe("<https://example.test/docs|see the docs>");
    expect(box.querySelector("a")).toHaveAttribute("href", "https://example.test/docs");
    expect(screen.queryByRole("textbox", { name: "Link address" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Link" }));
    expect(latest).toBe("see the docs");
  });

  it("inserts the address itself as the link when nothing is selected, and closes the address box with Escape", async () => {
    const box = await mount();
    const user = boxUser();
    await caretToEnd(box);
    await user.click(screen.getByRole("button", { name: "Link" }));
    await user.type(screen.getByRole("textbox", { name: "Link address" }), "https://example.test{Enter}");
    expect(latest).toBe("<https://example.test>");

    await user.click(screen.getByRole("button", { name: "Link" }));
    await user.click(screen.getByRole("button", { name: "Link" }));
    await user.type(screen.getByRole("textbox", { name: "Link address" }), "{Escape}");
    expect(screen.queryByRole("textbox", { name: "Link address" })).not.toBeInTheDocument();
  });

  it("links selected text when an address is pasted over it, instead of replacing the text", async () => {
    const box = await mount({ initial: "the docs" });
    const user = boxUser();
    await selectAll(box);
    await user.paste("https://example.test/docs");
    expect(latest).toBe("<https://example.test/docs|the docs>");
  });

  it("turns a typed address into a link", async () => {
    const box = await mount();
    await typeInto(box, "go to https://example.test now");
    expect(latest).toBe("go to <https://example.test> now");
  });

  it("can be left without a toolbar", async () => {
    render(<Harness toolbar={false} />);
    await messageBox("Message");
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });
});

describe("MessageBox: conveniences", () => {
  it("turns an emoticon into its emoji when a space or punctuation follows, but not in code, in a URL or mid-word", async () => {
    const box = await mount();
    await typeInto(box, "ok :) and <3! see http://x.test and 10:30 ");
    expect(latest).toBe("ok \u{1F642} and ❤️! see <http://x.test> and 10:30 ");

    cleanup();
    const code = await mount({ initial: "`a :" });
    await typeInto(code, ") ");
    expect(code.textContent).toContain(":)");
  });

  it("converts an emoticon in the middle of a line and keeps the caret after what was typed", async () => {
    const box = await mount({ initial: "x :)y" });
    const user = boxUser();
    await caretToEnd(box);
    // Put the caret right after ":)" (before "y") and type a space.
    const text = box.querySelector("p")!.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 4);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    await user.keyboard(" ");
    flushEditor(box);
    expect(latest).toBe("x \u{1F642} y");
  });

  it("is at most as tall as the cap and scrolls beyond it", async () => {
    const box = await mount();
    expect(box.getAttribute("style")).toContain(`max-height: ${MAX_BOX_HEIGHT_PX}px`);
    expect(box.getAttribute("style")).toContain("overflow-y: auto");
  });

  it("grows with its text: a floor from rows, a cap, and never a fixed height, even after a long paste", async () => {
    const box = await mount();
    const style = () => box.getAttribute("style") ?? "";
    expect(style()).toMatch(/min-height: \d/);
    expect(style()).not.toMatch(/(^|;)\s*height:/);
    await caretToEnd(box);
    await boxUser().paste(Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n"));
    await waitFor(() => expect(box.querySelectorAll("p").length).toBeGreaterThan(20));
    expect(style()).not.toMatch(/(^|;)\s*height:/);
    expect(style()).toContain(`max-height: ${MAX_BOX_HEIGHT_PX}px`);
  });

  describe("Backspace on an empty line of a quote", () => {
    it("steps out of the quote, so a comment can follow what is quoted", async () => {
      const box = await mount();
      await typeInto(box, "> sdf{Shift>}{Enter}{/Shift}{Backspace}ok");
      const quote = box.querySelector("blockquote")!;
      expect(quote).toHaveTextContent("sdf");
      expect(quote).not.toHaveTextContent("ok");
      expect(quote.querySelector("br:not(.ProseMirror-trailingBreak)")).toBeNull();
      expect(box.textContent).toBe("sdfok");
      expect(box.lastElementChild?.tagName).toBe("P");
      expect(box.lastElementChild).toHaveTextContent("ok");
    });

    it("leaves the quote alone when the line has text, and when the line break is not at the end", async () => {
      const box = await mount();
      await typeInto(box, "> one{Shift>}{Enter}{/Shift}two{Backspace}");
      expect(box.querySelectorAll("blockquote").length).toBe(1);
      expect(box.querySelector("blockquote")).toHaveTextContent("onetwo");
      expect(box.lastElementChild?.tagName).toBe("BLOCKQUOTE");
    });
  });

  it("turns pasted full names into mentions and leaves unknown ones as text", async () => {
    vi.mocked(suggestMentions).mockImplementation(async (_c, _t, q) => (q === "Ania Ray" ? [ANIA] : []));
    const box = await mount();
    await caretToEnd(box);
    await boxUser().paste("see @Ania Ray @Nobody\nthanks");
    await waitFor(() => expect(tokensRef.current.get("@Ania Ray")).toBe("<@U1>"));
    await waitFor(() => expect(latest).toBe("see @Ania Ray @Nobody\nthanks"));
    expect(tokensRef.current.size).toBe(1);
  });

  it("doesn't treat a pasted address with an @ in it as names, so it still links the selected text", async () => {
    const box = await mount({ initial: "profile" });
    await selectAll(box);
    await boxUser().paste("https://site.test/@someone");
    expect(latest).toBe("<https://site.test/@someone|profile>");
    expect(suggestMentions).not.toHaveBeenCalled();
  });

  it("pastes other text as it is when it names nobody", async () => {
    const box = await mount();
    await caretToEnd(box);
    await boxUser().paste("mail me@home or @");
    expect(latest).toBe("mail me@home or @");
    expect(suggestMentions).not.toHaveBeenCalled();
  });
});

describe("linkAddress", () => {
  it("adds https:// when there is no scheme, and accepts only web and mail addresses", () => {
    expect(linkAddress(" example.test/a ")).toBe("https://example.test/a");
    expect(linkAddress("http://example.test")).toBe("http://example.test");
    expect(linkAddress("mailto:fern@example.test")).toBe("mailto:fern@example.test");
    for (const bad of ["", "   ", "javascript:alert(1)", "not an address", "localhost", "ftp://example.test"]) expect(linkAddress(bad), bad).toBeNull();
  });
});

describe("MessageBox: placeholder", () => {
  it("is not drawn over an empty quote that typing > and a space starts", async () => {
    render(<MessageBox channelId="c1" aria-label="Message" value="" onValueChange={() => {}} tokens={tokensRef} placeholder="Say something" />);
    const box = await messageBox("Message");
    await boxUser().type(box, "> ");
    await waitFor(() => expect(box.querySelector("blockquote")).not.toBeNull());
    expect(screen.queryByText("Say something")).not.toBeInTheDocument();
  });

  it("stays while the box has focus and is empty, until something is typed", async () => {
    render(<MessageBox channelId="c1" aria-label="Message" value="" onValueChange={() => {}} tokens={tokensRef} placeholder="Say something" />);
    const box = await messageBox("Message");
    await boxUser().click(box);
    expect(screen.getByText("Say something")).toBeInTheDocument();
    await boxUser().type(box, "hi");
    await waitFor(() => expect(screen.queryByText("Say something")).not.toBeInTheDocument());
  });
});

describe("MessageBox: the text and the editor stay one", () => {
  it("shows text put in from outside, with its formatting, and takes it away again", async () => {
    function Outside() {
      const [value, setValue] = useState("");
      return (
        <>
          <button onClick={() => setValue("*bold* and > not a quote")}>fill</button>
          <button onClick={() => setValue("")}>clear</button>
          <MessageBox channelId="c1" aria-label="Message" value={value} onValueChange={setValue} tokens={tokensRef} placeholder="Say something" />
        </>
      );
    }
    render(<Outside />);
    const box = await messageBox("Message");
    const user = boxUser();
    expect(screen.getByText("Say something")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "fill" }));
    expect(box.querySelector("strong")).toHaveTextContent("bold");
    expect(box.textContent).toBe("bold and > not a quote");
    expect(screen.queryByText("Say something")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "clear" }));
    expect(box.textContent).toBe("");
    expect(screen.getByText("Say something")).toBeInTheDocument();
  });

  it("stops at maxLength, and hands the owner a way to focus it", async () => {
    const box = await mount({ maxLength: 5 });
    await typeInto(box, "abcdefgh");
    expect(latest).toBe("abcde");
    act(() => (document.activeElement as HTMLElement).blur());
    handle.current!.focus();
    await waitFor(() => expect(box).toHaveFocus());
  });

  it("hands its paste to the owner, which can take it", async () => {
    const onPaste = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    const box = await mount({ onPaste });
    await caretToEnd(box);
    await boxUser().paste("ignored text");
    expect(onPaste).toHaveBeenCalled();
    expect(latest).toBe("");
  });
});
