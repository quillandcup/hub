// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }), usePathname: () => "/dashboard" }));
vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ metrics: { distribution: vi.fn() } }));

const searchPalette = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/search", () => ({
  searchPalette: (q: string) => searchPalette(q),
  searchSuggestions: () => Promise.resolve({ needsAttention: [] }),
  suggestOperatorValues: () => Promise.resolve([]),
  markSuggestionsRead: vi.fn(),
}));

vi.mock("@/app/(member)/chat/actions", () => ({ sendChatMessage: vi.fn(), retryChatMessage: vi.fn(), prepareChatUploads: vi.fn(), saveChatDraft: vi.fn() }));
vi.mock("@/lib/chat/drafts", async (orig) => ({ ...(await orig<typeof import("@/lib/chat/drafts")>()), DRAFT_SAVE_DELAY_MS: 1 }));
vi.mock("@/app/(member)/chat/mention-actions", () => ({ suggestMentions: vi.fn() }));
import { saveChatDraft, sendChatMessage } from "@/app/(member)/chat/actions";
import { suggestMentions } from "@/app/(member)/chat/mention-actions";

import Composer from "@/components/chat/Composer";
import Modal from "@/components/Modal";
import MultiEntitySearch from "@/components/MultiEntitySearch";
import SearchPalette from "@/components/search/SearchPalette";
import ShortcutsProvider, { useShortcutsPanel } from "@/components/shortcuts/ShortcutsProvider";
import { SHORTCUTS, type Shortcut } from "@/lib/shortcuts";
import { messageBox, typeInto } from "../helpers/message-box";

/**
 * Drift guard for the keyboard shortcuts panel (`lib/shortcuts.ts`): for every hand-written entry of the registry,
 * the real component is rendered, the keys the registry shows are pressed, and the handler must respond. The keys
 * come from the registry, so changing a key there (or in a handler) fails the matching driver. The table and
 * calendar entries are read from their components' own constants (`tests/lib/shortcuts.test.ts`) and are not here.
 *
 * Adding a shortcut to the registry? Add a driver below under its id (rule: `.claude/rules/keyboard-shortcuts.md`).
 */

type Chord = string[];

const MODIFIERS = ["mod", "ctrl", "alt", "shift"];
const MODIFIER_KEY: Record<string, string> = { mod: "Control", ctrl: "Control", alt: "Alt", shift: "Shift" };
const NAMED_KEY: Record<string, string> = { enter: "Enter", esc: "Escape", up: "ArrowUp", down: "ArrowDown", backspace: "Backspace" };

/** A registry chord (`["mod", "K"]`) as a user-event keyboard string (`{Control>}k{/Control}`). */
function keyString(chord: Chord): string {
  const mods = chord.filter((key) => MODIFIERS.includes(key.toLowerCase()));
  const main = chord.filter((key) => !MODIFIERS.includes(key.toLowerCase()));
  expect(main, `chord ${chord.join("+")} must have exactly one non-modifier key`).toHaveLength(1);
  const name = NAMED_KEY[main[0].toLowerCase()];
  const key = name ? `{${name}}` : main[0].length === 1 && /[a-z]/i.test(main[0]) ? main[0].toLowerCase() : main[0];
  return mods.map((m) => `{${MODIFIER_KEY[m.toLowerCase()]}>}`).join("") + key + [...mods].reverse().map((m) => `{/${MODIFIER_KEY[m.toLowerCase()]}}`).join("");
}

/** The chord of a shortcut whose main key is `key` (a changed registry key surfaces here, with a clear message). */
function chordFor(shortcut: Shortcut, key: string): Chord {
  const found = shortcut.keys.find((chord) => chord[chord.length - 1].toLowerCase() === key.toLowerCase());
  if (!found) throw new Error(`shortcut ${shortcut.id} no longer lists ${key}: its handler and the registry have drifted (registry has ${JSON.stringify(shortcut.keys)})`);
  return found;
}

function mockKeyboard() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: true,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

const results = {
  results: [
    { kind: "members", hasMore: false, hits: [{ kind: "members", id: "m1", title: "Ada Example", subtitle: "Writes fantasy", href: "/members/m1" }] },
    { kind: "books", hasMore: false, hits: [{ kind: "books", id: "b1", title: "Example Guide", subtitle: "Fern", date: "2026-10-01", href: "/bookshelf" }] },
  ],
};

const paletteInput = () => screen.queryByRole("textbox", { name: "Search" });

async function openPaletteWithResults() {
  const user = userEvent.setup();
  render(<SearchPalette resultsPath="/search" isAdmin={false} />);
  await user.click(screen.getByRole("button", { name: "Search pages, members, chat…" }));
  await user.type(screen.getByRole("textbox", { name: "Search" }), "example");
  await screen.findByRole("heading", { name: "Members" });
  return user;
}

const currentRow = () => document.querySelector("[aria-current]")?.textContent ?? null;

function PanelProbe() {
  const { open } = useShortcutsPanel();
  return <p>{open ? "panel open" : "panel closed"}</p>;
}

function renderPanel() {
  render(
    <ShortcutsProvider>
      <PanelProbe />
    </ShortcutsProvider>,
  );
}

const PEOPLE = [
  { id: "a", name: "Alder" },
  { id: "b", name: "Alma" },
  { id: "c", name: "Alma Two" },
];

function Picker({ initial = [] as string[] }: { initial?: string[] }) {
  const [ids, setIds] = useState(initial);
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <MultiEntitySearch items={PEOPLE} selectedIds={ids} onChange={setIds} placeholder="find" />
      <output data-testid="chosen">{ids.join(",")}</output>
    </form>
  );
}

const pickerInput = () => screen.getByRole("combobox", { name: "find" });

type Driver = (shortcut: Shortcut) => Promise<void>;

const DRIVERS: Record<string, Driver> = {
  "basics-panel": async (s) => {
    mockKeyboard();
    renderPanel();
    const user = userEvent.setup();
    await user.keyboard(keyString(chordFor(s, "?")));
    expect(screen.getByText("panel open")).toBeInTheDocument();
    await user.keyboard(keyString(chordFor(s, "?")));
    expect(screen.getByText("panel closed")).toBeInTheDocument();
  },
  "basics-close": async (s) => {
    const user = userEvent.setup();
    // A dialog closes on it.
    const onClose = vi.fn();
    render(
      <Modal isOpen onClose={onClose} title="Example">
        body
      </Modal>,
    );
    await user.keyboard(keyString(chordFor(s, "esc")));
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
    // And so does the panel itself.
    mockKeyboard();
    renderPanel();
    await user.keyboard("?");
    expect(screen.getByText("panel open")).toBeInTheDocument();
    await user.keyboard(keyString(chordFor(s, "esc")));
    expect(screen.getByText("panel closed")).toBeInTheDocument();
  },

  "search-open": async (s) => {
    for (const chord of s.keys) {
      render(<SearchPalette resultsPath="/search" isAdmin={false} />);
      expect(paletteInput(), `${chord.join("+")}: palette starts closed`).not.toBeInTheDocument();
      await userEvent.setup().keyboard(keyString(chord));
      expect(await screen.findByRole("textbox", { name: "Search" }), `${chord.join("+")} opens the search`).toBeInTheDocument();
      cleanup();
    }
  },
  "search-move": async (s) => {
    const user = await openPaletteWithResults();
    await user.keyboard(keyString(chordFor(s, "down")));
    const first = currentRow();
    expect(first).not.toBeNull();
    await user.keyboard(keyString(chordFor(s, "down")));
    expect(currentRow()).not.toBe(first);
    await user.keyboard(keyString(chordFor(s, "up")));
    expect(currentRow()).toBe(first);
  },
  "search-go": async (s) => {
    const user = await openPaletteWithResults();
    const down = keyString(chordFor(SHORTCUTS.find((x) => x.id === "search-move")!, "down"));
    await user.keyboard(down);
    await user.keyboard(down);
    await user.keyboard(keyString(chordFor(s, "enter")));
    expect(push).toHaveBeenLastCalledWith("/bookshelf");
  },
  "search-close": async (s) => {
    const user = await openPaletteWithResults();
    await user.keyboard(keyString(chordFor(s, "esc")));
    expect(paletteInput()).not.toBeInTheDocument();
  },

  "forms-submit": async (s) => {
    const onSubmit = vi.fn();
    render(
      <Modal isOpen onClose={() => {}} title="Example">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <input aria-label="Name" />
          <button type="submit">Save</button>
        </form>
      </Modal>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("textbox", { name: "Name" }));
    await user.keyboard(keyString(chordFor(s, "enter")));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  },
  "pickers-move": async (s) => {
    render(<Picker />);
    const user = userEvent.setup();
    await user.type(pickerInput(), "al");
    const ids = () => screen.getAllByRole("option").map((o) => o.id);
    await user.keyboard(keyString(chordFor(s, "down")));
    expect(pickerInput()).toHaveAttribute("aria-activedescendant", ids()[0]);
    await user.keyboard(keyString(chordFor(s, "down")));
    expect(pickerInput()).toHaveAttribute("aria-activedescendant", ids()[1]);
    await user.keyboard(keyString(chordFor(s, "up")));
    expect(pickerInput()).toHaveAttribute("aria-activedescendant", ids()[0]);
  },
  "pickers-pick": async (s) => {
    render(<Picker />);
    const user = userEvent.setup();
    await user.type(pickerInput(), "alma");
    await user.keyboard("{ArrowDown}");
    await user.keyboard(keyString(chordFor(s, "enter")));
    expect(screen.getByTestId("chosen")).toHaveTextContent("b");
  },
  "pickers-close": async (s) => {
    render(<Picker />);
    const user = userEvent.setup();
    await user.type(pickerInput(), "al");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard(keyString(chordFor(s, "esc")));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  },
  "pickers-remove": async (s) => {
    render(<Picker initial={["a", "b"]} />);
    const user = userEvent.setup();
    await user.click(pickerInput());
    await user.keyboard(keyString(chordFor(s, "backspace")));
    expect(screen.getByTestId("chosen")).toHaveTextContent(/^a$/);
  },

  "chat-send": async (s) => {
    vi.mocked(sendChatMessage).mockResolvedValue({ ok: true, id: "m1" });
    render(<Composer channelId="c1" placeholder="Message #hosts" />);
    await typeInto(await messageBox(), `hello${keyString(chordFor(s, "enter"))}`);
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledWith("c1", "hello", undefined, []));
  },
  "chat-newline": async (s) => {
    render(<Composer channelId="c1" placeholder="Message #hosts" />);
    const box = await messageBox();
    await typeInto(box, `one${keyString(chordFor(s, "enter"))}two`);
    expect(sendChatMessage).not.toHaveBeenCalled();
    expect(box.innerHTML).toContain("one<br>two");
  },
};

/** Entries that are read from their component's own constant, so they cannot drift (see `tests/lib/shortcuts.test.ts`). */
const DERIVED_GROUPS = ["table", "calendar"];
const HAND_WRITTEN = SHORTCUTS.filter((s) => !DERIVED_GROUPS.includes(s.group));

describe("keyboard shortcuts panel: every hand-written entry is backed by a handler", () => {
  beforeEach(() => {
    push.mockReset();
    searchPalette.mockReset().mockResolvedValue(results);
    vi.mocked(sendChatMessage).mockReset();
    vi.mocked(saveChatDraft).mockReset().mockResolvedValue(undefined);
    vi.mocked(suggestMentions).mockReset().mockResolvedValue([]);
    Element.prototype.scrollIntoView = vi.fn();
    localStorage.clear();
    mockKeyboard();
  });
  afterEach(() => cleanup());

  it("has a behavior driver for each hand-written registry entry, and none for an entry that is gone", () => {
    const missing = HAND_WRITTEN.filter((s) => !DRIVERS[s.id]).map(
      (s) => `shortcut ${s.id} has no behavior test; add a driver in tests/components/ShortcutDrivers.test.tsx`,
    );
    expect(missing).toEqual([]);
    const stale = Object.keys(DRIVERS).filter((id) => !HAND_WRITTEN.some((s) => s.id === id));
    expect(stale, "drivers for ids the registry no longer has").toEqual([]);
  });

  it.each(HAND_WRITTEN.map((s) => [s.id, s] as const))("%s: its registered keys do what the panel says", async (id, shortcut) => {
    const driver = DRIVERS[id];
    if (!driver) throw new Error(`shortcut ${id} has no behavior test; add a driver in tests/components/ShortcutDrivers.test.tsx`);
    await driver(shortcut);
  });
});
