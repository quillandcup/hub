// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
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

const landing = vi.hoisted(() => ({ save: vi.fn(), back: vi.fn(), forward: vi.fn(), change: undefined as undefined | ((data: unknown) => void) }));
vi.mock("@puckeditor/core/no-external.css", () => ({}));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/components/landing/editor-config", () => ({ editorConfig: {}, editorConfigFor: () => ({}) }));
vi.mock("@/components/media/MediaPicker", () => ({ default: () => <div>picker</div> }));
vi.mock("../../app/(admin)/admin/pages/actions", () => ({
  saveLandingDraft: landing.save,
  publishLandingPage: vi.fn(),
  unpublishLandingPage: vi.fn(),
  restoreLandingPageVersion: vi.fn(),
  resetLandingDraftToPublished: vi.fn(),
  updateLandingPageDetails: vi.fn(),
}));
vi.mock("@puckeditor/core", () => ({
  Puck: ({ onChange, overrides }: { onChange: (data: unknown) => void; overrides: { header: () => ReactNode } }) => {
    landing.change = onChange;
    return <div>{overrides.header()}</div>;
  },
  createUsePuck: () => (select: (state: unknown) => unknown) =>
    select({
      history: { hasPast: true, hasFuture: true, back: landing.back, forward: landing.forward },
      dispatch: vi.fn(),
      appState: { ui: { leftSideBarVisible: true, rightSideBarVisible: false, viewports: { current: { width: 1280, height: "auto" }, controlsVisible: false, options: [] } } },
    }),
}));

import Composer from "@/components/chat/Composer";
import ImageLightbox from "@/components/ImageLightbox";
import LandingEditor, { type EditorPage } from "@/app/(admin)/admin/pages/[slug]/LandingEditor";
import EntitySearch from "@/components/EntitySearch";
import Modal from "@/components/Modal";
import MultiEntitySearch from "@/components/MultiEntitySearch";
import PhotoLightbox from "@/components/PhotoLightbox";
import SearchPalette from "@/components/search/SearchPalette";
import ShortcutsProvider, { useShortcutsPanel, useShortcutsState } from "@/components/shortcuts/ShortcutsProvider";
import ShortcutsLayout from "@/components/shortcuts/ShortcutsPanel";
import { SHORTCUTS, visibleSections, type Shortcut } from "@/lib/shortcuts";
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
const NAMED_KEY: Record<string, string> = { enter: "Enter", esc: "Escape", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", backspace: "Backspace" };

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

/** A registered shortcut as `aria-keyshortcuts` text: every chord, "mod" as both Control and Meta. */
function declared(shortcut: Shortcut) {
  return shortcut.keys
    .flatMap((chord) => ["Control", "Meta"].map((mod) => chord.map((k) => (k === "mod" ? mod : k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1))).join("+")))
    .join(" ");
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

const landingPage: EditorPage = { id: "lpg_AAAAAAAAAAA1", slug: "spring", title: "Spring sprint", status: "draft", seoTitle: "", seoDescription: "", socialImageAssetId: "", publishedJson: null, publicPath: "/p/spring" };
const landingData = { content: [{ type: "Heading", props: { id: "h", text: "Welcome", level: "h1", align: "center" } }], root: {} };
const renderLandingEditor = () => render(<LandingEditor page={landingPage} data={landingData} versions={[]} />);

const PHOTOS = [
  { id: "p1", src: "/p1.jpg", alt: "First" },
  { id: "p2", src: "/p2.jpg", alt: "Second" },
  { id: "p3", src: "/p3.jpg", alt: "Third" },
];

function PhotoViewer({ start }: { start: number }) {
  const [open, setOpen] = useState<number | null>(start);
  return <PhotoLightbox photos={PHOTOS} openIndex={open} onClose={() => setOpen(null)} onNavigate={setOpen} />;
}

const shownPhoto = (container: HTMLElement) => container.querySelector("img")?.getAttribute("alt") ?? null;

/** Left and Right step through the photos of both viewers and stop at the ends. */
async function stepThroughViewers(previous: Shortcut, next: Shortcut) {
  const user = userEvent.setup();
  const left = keyString(chordFor(previous, "left"));
  const right = keyString(chordFor(next, "right"));

  const image = render(<ImageLightbox images={PHOTOS.map(({ src, alt }) => ({ src, name: alt }))} onClose={vi.fn()} />);
  await user.keyboard(right);
  expect(shownPhoto(image.container)).toBe("Second");
  await user.keyboard(right + right);
  expect(shownPhoto(image.container), "stops at the last photo").toBe("Third");
  await user.keyboard(left);
  expect(shownPhoto(image.container)).toBe("Second");
  cleanup();

  const photo = render(<PhotoViewer start={0} />);
  await user.keyboard(left);
  expect(shownPhoto(photo.container), "stops at the first photo").toBe("First");
  await user.keyboard(right);
  expect(shownPhoto(photo.container)).toBe("Second");
  await user.keyboard(right + right);
  expect(shownPhoto(photo.container), "stops at the last photo").toBe("Third");
  await user.keyboard(left);
  expect(shownPhoto(photo.container)).toBe("Second");
}

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

  "landing-editor-save": async (s) => {
    landing.save.mockResolvedValue({ savedAt: "2027-01-01T00:00:00Z" });
    renderLandingEditor();
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    act(() => landing.change!({ content: [{ ...landingData.content[0], props: { ...landingData.content[0].props, text: "Changed" } }], root: {} }));
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
    expect(landing.save).not.toHaveBeenCalled();
    await userEvent.setup().keyboard(keyString(chordFor(s, "s")));
    await waitFor(() => expect(landing.save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
  },
  // Puck owns these hotkeys (its own handler is not in this mock), so the driver pins what is ours: the buttons declare the registered keys and run the same actions.
  "landing-editor-undo": async (s) => {
    landing.back.mockClear();
    renderLandingEditor();
    const button = screen.getByRole("button", { name: "Undo" });
    expect(button.getAttribute("aria-keyshortcuts")).toBe(declared(s));
    await userEvent.setup().click(button);
    expect(landing.back).toHaveBeenCalledTimes(1);
  },
  "landing-editor-redo": async (s) => {
    landing.forward.mockClear();
    renderLandingEditor();
    const button = screen.getByRole("button", { name: "Redo" });
    expect(button.getAttribute("aria-keyshortcuts")).toBe(declared(s));
    await userEvent.setup().click(button);
    expect(landing.forward).toHaveBeenCalledTimes(1);
  },
  "photo-viewer-previous": (s) => stepThroughViewers(s, SHORTCUTS.find((x) => x.id === "photo-viewer-next")!),
  "photo-viewer-next": (s) => stepThroughViewers(SHORTCUTS.find((x) => x.id === "photo-viewer-previous")!, s),
};

/** Entries that are read from their component's own constant, so they cannot drift (see `tests/lib/shortcuts.test.ts`). */
const DERIVED_GROUPS = ["table", "calendar"];
const HAND_WRITTEN = SHORTCUTS.filter((s) => !DERIVED_GROUPS.includes(s.group));

describe("keyboard shortcuts panel: every hand-written entry is backed by a handler", () => {
  beforeEach(() => {
    push.mockReset();
    searchPalette.mockReset().mockResolvedValue(results);
    vi.mocked(sendChatMessage).mockReset();
    landing.save.mockReset();
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

describe("keyboard shortcuts panel: page-scoped groups appear only while their component is on the page", () => {
  beforeEach(() => mockKeyboard());
  afterEach(() => cleanup());

  const panel = () => screen.queryByRole("complementary", { name: "Keyboard shortcuts" });

  function Page({ children }: { children: ReactNode }) {
    return (
      <ShortcutsProvider>
        {children}
        <ShortcutsLayout>
          <main />
        </ShortcutsLayout>
      </ShortcutsProvider>
    );
  }

  it("lists the photo viewer keys while a lightbox is open, and not once it is closed", async () => {
    const user = userEvent.setup();
    render(
      <Page>
        <PhotoViewer start={1} />
      </Page>,
    );
    await user.keyboard("?");
    expect(within(panel()!).getByRole("heading", { name: "Photo viewer" })).toBeInTheDocument();
    expect(within(panel()!).getByText("Previous photo")).toBeInTheDocument();
    expect(within(panel()!).getByText("Next photo")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    cleanup();
    // A closed PhotoLightbox (no photo chosen) reports nothing.
    render(
      <Page>
        <PhotoLightbox photos={PHOTOS} openIndex={null} onClose={vi.fn()} onNavigate={vi.fn()} />
      </Page>,
    );
    await user.keyboard("?");
    expect(within(panel()!).queryByRole("heading", { name: "Photo viewer" })).toBeNull();
  });

  it("lists the picker keys only while a picker is on the page", async () => {
    const user = userEvent.setup();
    render(
      <Page>
        <Picker />
      </Page>,
    );
    await user.keyboard("?");
    expect(within(panel()!).getByRole("heading", { name: "Pickers" })).toBeInTheDocument();
    expect(within(panel()!).getByText("Move through a picker's options")).toBeInTheDocument();
    expect(within(panel()!).queryByRole("heading", { name: "Forms in dialogs" })).toBeNull();
    cleanup();
    render(<Page>{null}</Page>);
    await user.keyboard("?");
    expect(within(panel()!).queryByRole("heading", { name: "Pickers" })).toBeNull();
  });

  it("closes a picker's list with Escape, which the Basics entry for Esc says", async () => {
    const user = userEvent.setup();
    render(<Picker />);
    await user.type(pickerInput(), "al");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(SHORTCUTS.find((s) => s.id === "basics-close")!.label).toMatch(/picker's list/);
  });

  it("lists the picker keys for a single-choice picker too", async () => {
    const user = userEvent.setup();
    render(
      <Page>
        <EntitySearch items={PEOPLE} selectedId="" onSelect={vi.fn()} ariaLabel="one" />
      </Page>,
    );
    await user.keyboard("?");
    expect(within(panel()!).getByRole("heading", { name: "Pickers" })).toBeInTheDocument();
  });

  it("lists the dialog form key only while a dialog with a form is open", async () => {
    // `?` is ignored while a dialog is open, so read what the panel would show from the provider's own state.
    const seen: string[][] = [];
    function Probe() {
      const state = useShortcutsState();
      seen.push(visibleSections(state?.registrations ?? []).map((s) => s.group));
      return null;
    }
    const last = () => seen[seen.length - 1];
    const dialog = (open: boolean, body: ReactNode) => (
      <ShortcutsProvider>
        <Probe />
        <Modal isOpen={open} onClose={() => {}} title="Example">
          {body}
        </Modal>
      </ShortcutsProvider>
    );
    const form = (
      <form>
        <input aria-label="Name" />
        <button type="submit">Save</button>
      </form>
    );
    const { rerender } = render(dialog(true, form));
    await waitFor(() => expect(last()).toContain("forms"));
    rerender(dialog(true, <p>Nothing to save</p>));
    await waitFor(() => expect(last()).not.toContain("forms"));
    rerender(dialog(true, <form data-no-mod-enter-submit />));
    await waitFor(() => expect(last()).not.toContain("forms"));
    rerender(dialog(true, form));
    await waitFor(() => expect(last()).toContain("forms"));
    rerender(dialog(false, form));
    await waitFor(() => expect(last()).not.toContain("forms"));
    expect(last()).toEqual(["basics", "search"]);
  });

  it("lists the page editor's save key only on the editor page", async () => {
    const user = userEvent.setup();
    render(
      <Page>
        <LandingEditor page={landingPage} data={landingData} versions={[]} />
      </Page>,
    );
    await user.keyboard("?");
    expect(within(panel()!).getByRole("heading", { name: "Page editor" })).toBeInTheDocument();
    cleanup();
    render(<Page>{null}</Page>);
    await user.keyboard("?");
    expect(within(panel()!).queryByRole("heading", { name: "Page editor" })).toBeNull();
  });

  it("leaves Left and Right alone while typing, with a modifier held, or when no viewer is open", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <div>
        <input aria-label="Caption" />
        <ImageLightbox images={PHOTOS.map(({ src, alt }) => ({ src, name: alt }))} onClose={vi.fn()} />
      </div>,
    );
    await user.click(screen.getByRole("textbox", { name: "Caption" }));
    await user.keyboard("{ArrowRight}");
    expect(shownPhoto(container)).toBe("First");
    await user.click(document.body);
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(shownPhoto(container)).toBe("First");
    cleanup();
    const closed = render(<PhotoViewer start={0} />);
    await user.keyboard("{Escape}");
    expect(closed.container.querySelector("img")).toBeNull();
    await user.keyboard("{ArrowRight}");
    expect(closed.container.querySelector("img")).toBeNull();
  });
});
