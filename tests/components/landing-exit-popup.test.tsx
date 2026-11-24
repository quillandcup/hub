// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExitPopupBlock } from "@/components/landing/blocks";
import ExitPopupEditing, { EditPopupField, setEditingPopup } from "@/components/landing/ExitPopupEditing";
import { CONSENT_STORAGE_KEY } from "@/lib/analytics/consent";
import { trapTab } from "@/lib/landing/focus-trap";
import { DELAY_DEFAULT, EXIT_ARM_MS, CLOSED_KEY, OPT_IN_DONE_EVENT, SIGNED_UP_KEY, TYPING_RETRY_MS, popupStorageKey } from "@/lib/landing/exit-popup";
import { useFakeClock } from "../helpers/fake-clock";

/** What the popup's blocks are: a heading, a field and a button, so there is something to focus. */
const Inside = () => (
  <div>
    <p>Join the list</p>
    <input aria-label="Your email" />
    <button type="button">Sign me up</button>
  </div>
);

const props = (extra: Record<string, unknown> = {}) => ({ enabled: true, trigger: "either", delaySeconds: 10, rememberDays: 7, closeOnOverlay: true, hideOnDesktop: false, hideOnMobile: false, label: "Join the newsletter", width: "medium", background: "white", content: Inside, ...extra });

function visit(path: string) {
  window.history.pushState({}, "", path);
}

/** A window of the given kind: wide or narrow, with or without a mouse. */
function stubDevice({ wide = true, mouse = true }: { wide?: boolean; mouse?: boolean } = {}) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width") ? wide : query.includes("hover") ? mouse : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const advance = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));
const dialog = () => screen.queryByRole("dialog");
/** The record slice 1 kept per page; still read, never written. */
const legacyKey = popupStorageKey("spring");
function clickOverlay() {
  const overlay = document.querySelector("[data-exit-popup]") as HTMLElement;
  fireEvent.mouseDown(overlay);
  fireEvent.click(overlay);
}

beforeAll(async () => {
  // The window's code is fetched on demand; warm it so its dynamic import settles in the same tick.
  await import("@/components/landing/ExitPopupDialog");
});

describe("Exit popup on the public page", () => {
  const fake = useFakeClock(() => Date.UTC(2026, 10, 23, 15, 0, 0));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    visit("/p/spring");
    stubDevice();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
    document.cookie = "sb-abcdefgh-auth-token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    document.documentElement.removeAttribute("data-consent-required");
    document.body.style.overflow = "";
    visit("/");
  });

  async function opens(ms = DELAY_DEFAULT * 1000) {
    await advance(ms);
    await vi.waitFor(() => expect(dialog()).toBeInTheDocument());
  }
  const staysShut = async (ms: number) => {
    await advance(ms);
    // Give the window's code every chance to load and show; it must not.
    await act(async () => void (await Promise.resolve()));
    expect(dialog()).toBeNull();
  };

  it("draws nothing for a visitor while it is switched off, and only a hidden anchor while it is on (the blocks inside are not in the page)", () => {
    const off = render(<ExitPopupBlock {...props({ enabled: false })} />);
    expect(off.container).toBeEmptyDOMElement();
    off.unmount();
    const on = render(<ExitPopupBlock {...props()} />);
    expect(on.container.querySelector("[data-exit-popup-anchor]")).toHaveAttribute("hidden");
    expect(screen.queryByText("Join the list")).toBeNull();
    expect(dialog()).toBeNull();
  });

  it("shows after the delay, not before, as a dialog with a name, with the popup's blocks in it", async () => {
    render(<ExitPopupBlock {...props()} />);
    await staysShut(9000);
    await opens(1000);
    const box = screen.getByRole("dialog", { name: "Join the newsletter" });
    expect(box).toHaveAttribute("aria-modal", "true");
    expect(box).toHaveTextContent("Join the list");
    // On the page's own body, not inside the page.
    expect(box.closest("[data-exit-popup]")?.parentElement).toBe(document.body);
  });

  it("falls back to a name when none was typed", async () => {
    render(<ExitPopupBlock {...props({ label: "" })} />);
    await opens();
    expect(screen.getByRole("dialog", { name: "Pop-up" })).toBeInTheDocument();
  });

  it("shows when the mouse leaves through the top of the window, but not in the first moments and not out of the side or bottom", async () => {
    render(<ExitPopupBlock {...props({ trigger: "exit" })} />);
    fireEvent.mouseOut(document, { clientY: 0, relatedTarget: null });
    await staysShut(1000);
    await advance(EXIT_ARM_MS);
    fireEvent.mouseOut(document, { clientY: 400, relatedTarget: null });
    fireEvent.mouseOut(document, { clientY: 0, relatedTarget: document.body });
    await staysShut(0);
    fireEvent.mouseOut(document, { clientY: 0, relatedTarget: null });
    await vi.waitFor(() => expect(dialog()).toBeInTheDocument());
  });

  it("shows once: leaving after it has shown does not open a second time", async () => {
    render(<ExitPopupBlock {...props()} />);
    await opens();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(dialog()).toBeNull();
    await advance(EXIT_ARM_MS);
    fireEvent.mouseOut(document, { clientY: 0, relatedTarget: null });
    await staysShut(60_000);
  });

  it("waits while the visitor is typing in a field of the page, then shows", async () => {
    render(
      <>
        <input aria-label="On the page" />
        <ExitPopupBlock {...props()} />
      </>,
    );
    screen.getByLabelText("On the page").focus();
    await staysShut(DELAY_DEFAULT * 1000);
    screen.getByLabelText("On the page").blur();
    await opens(TYPING_RETRY_MS);
  });

  it("closes with Escape, gives the page its scroll and its focus back", async () => {
    document.body.style.overflow = "scroll";
    render(
      <>
        <button type="button">Page button</button>
        <ExitPopupBlock {...props()} />
      </>,
    );
    screen.getByRole("button", { name: "Page button" }).focus();
    await opens();
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByRole("dialog")).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(dialog()).toBeNull();
    expect(document.body.style.overflow).toBe("scroll");
    expect(screen.getByRole("button", { name: "Page button" })).toHaveFocus();
  });

  it("gives the scroll back when the page is left while it is open", async () => {
    const view = render(<ExitPopupBlock {...props()} />);
    await opens();
    view.unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps Tab inside: the close button comes first and the order wraps both ways", async () => {
    render(<ExitPopupBlock {...props()} />);
    await opens();
    const close = screen.getByRole("button", { name: "Close" });
    const last = screen.getByRole("button", { name: "Sign me up" });
    // Focus starts on the box itself (the browser then moves it to the first stop, which is the close button).
    expect(screen.getByRole("dialog")).toHaveFocus();
    close.focus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    // Other keys are left to the browser, and focus that got outside (a click on the page behind) is brought back in.
    const stay = fireEvent.keyDown(last, { key: "a" });
    expect(stay).toBe(true);
    const behind = document.createElement("button");
    document.body.append(behind);
    behind.focus();
    expect(screen.getByRole("dialog")).toHaveFocus();
    behind.remove();
  });

  it("closes from the close button, and from a click outside the box only when it is set to", async () => {
    const first = render(<ExitPopupBlock {...props()} />);
    await opens();
    fireEvent.click(screen.getByText("Join the list"));
    expect(dialog()).toBeInTheDocument();
    clickOverlay();
    expect(dialog()).toBeNull();
    first.unmount();
    localStorage.clear();

    render(<ExitPopupBlock {...props({ closeOnOverlay: false })} />);
    await opens();
    clickOverlay();
    expect(dialog()).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(dialog()).toBeNull();
  });

  it("does not close when a click starts inside the box and ends on the overlay", async () => {
    render(<ExitPopupBlock {...props()} />);
    await opens();
    const overlay = document.querySelector("[data-exit-popup]") as HTMLElement;
    fireEvent.mouseDown(screen.getByText("Join the list"));
    fireEvent.click(overlay);
    expect(dialog()).toBeInTheDocument();
  });

  describe("how long it stays away", () => {
    it("remembers that it was closed, and leaves the visitor alone for the days it was told to", async () => {
      const first = render(<ExitPopupBlock {...props()} />);
      await opens();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(JSON.parse(localStorage.getItem(CLOSED_KEY)!)).toEqual({ at: fake.clock.now(), days: 7 });
      expect(localStorage.getItem(legacyKey)).toBeNull();
      first.unmount();

      fake.clock.advance(6 * 24 * 60 * 60 * 1000);
      render(<ExitPopupBlock {...props()} />);
      await staysShut(DELAY_DEFAULT * 1000);
      cleanup();

      fake.clock.advance(2 * 24 * 60 * 60 * 1000);
      render(<ExitPopupBlock {...props()} />);
      await opens();
    });

    it("remembers nothing when the days are zero, so it may show on the next visit", async () => {
      const first = render(<ExitPopupBlock {...props({ rememberDays: 0 })} />);
      await opens();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(localStorage.getItem(CLOSED_KEY)).toBeNull();
      first.unmount();
      render(<ExitPopupBlock {...props({ rememberDays: 0 })} />);
      await opens();
    });

    it("is site-wide: a close on one page keeps the popup of another page away, for the days of the popup that was closed", async () => {
      visit("/p/autumn");
      const first = render(<ExitPopupBlock {...props({ rememberDays: 3 })} />);
      await opens();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      first.unmount();

      visit("/p/spring");
      fake.clock.advance(2 * 24 * 60 * 60 * 1000);
      // The other popup asks for 30 days, but the stored 3 days are what counts.
      const second = render(<ExitPopupBlock {...props({ rememberDays: 30 })} />);
      await staysShut(DELAY_DEFAULT * 1000);
      second.unmount();
      fake.clock.advance(2 * 24 * 60 * 60 * 1000);
      render(<ExitPopupBlock {...props({ rememberDays: 30 })} />);
      await opens();
    });

    it("lets a later close overwrite the earlier one", async () => {
      localStorage.setItem(CLOSED_KEY, JSON.stringify({ at: fake.clock.now() - 20 * 24 * 60 * 60 * 1000, days: 7 }));
      const first = render(<ExitPopupBlock {...props({ rememberDays: 2 })} />);
      await opens();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(JSON.parse(localStorage.getItem(CLOSED_KEY)!)).toEqual({ at: fake.clock.now(), days: 2 });
      first.unmount();
    });

    it("still leaves alone a visitor who has a slice 1 record for this page, and writes none of its own", async () => {
      localStorage.setItem(legacyKey, JSON.stringify({ at: fake.clock.now(), submitted: false }));
      render(<ExitPopupBlock {...props()} />);
      await staysShut(DELAY_DEFAULT * 1000);
      cleanup();
      visit("/p/another-page");
      render(<ExitPopupBlock {...props()} />);
      await opens();
    });

    it("ignores a record it cannot read", async () => {
      localStorage.setItem(legacyKey, "not json");
      localStorage.setItem(CLOSED_KEY, "not json");
      render(<ExitPopupBlock {...props()} />);
      await opens();
    });

    it("works, without remembering, when the browser refuses storage", async () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      render(<ExitPopupBlock {...props()} />);
      await opens();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(dialog()).toBeNull();
      vi.restoreAllMocks();
    });
  });

  describe("consent", () => {
    it("keeps nothing where the consent banner asks and has not been accepted, and shows at most once per page load", async () => {
      document.documentElement.setAttribute("data-consent-required", "");
      render(<ExitPopupBlock {...props()} />);
      await opens();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(localStorage.length).toBe(0);
    });

    it("keeps its record there once the banner was accepted, and not when it was declined", async () => {
      document.documentElement.setAttribute("data-consent-required", "");
      localStorage.setItem(CONSENT_STORAGE_KEY, "granted");
      const first = render(<ExitPopupBlock {...props()} />);
      await opens();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(localStorage.getItem(CLOSED_KEY)).not.toBeNull();
      first.unmount();
      localStorage.clear();
      localStorage.setItem(CONSENT_STORAGE_KEY, "denied");
      render(<ExitPopupBlock {...props()} />);
      await opens();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(localStorage.getItem(CLOSED_KEY)).toBeNull();
    });
  });

  describe("who never sees it", () => {
    it("a signed-in member or staff, told by the sign-in cookie's name", async () => {
      document.cookie = "sb-abcdefgh-auth-token=session; path=/";
      render(<ExitPopupBlock {...props()} />);
      await staysShut(DELAY_DEFAULT * 1000 * 2);
    });

    it("a visitor who signs up while the page is open, with the popup's form or any other", async () => {
      render(<ExitPopupBlock {...props()} />);
      await advance(5000);
      act(() => void window.dispatchEvent(new Event(OPT_IN_DONE_EVENT)));
      await staysShut(60_000);
    });

    it("a visitor who signed up on any page, on a later visit to any page, for a year", async () => {
      localStorage.setItem(SIGNED_UP_KEY, JSON.stringify({ at: fake.clock.now(), submitted: true }));
      fake.clock.advance(200 * 24 * 60 * 60 * 1000);
      visit("/p/another-page");
      render(<ExitPopupBlock {...props({ rememberDays: 0 })} />);
      await staysShut(DELAY_DEFAULT * 1000);
      cleanup();
      fake.clock.advance(200 * 24 * 60 * 60 * 1000);
      render(<ExitPopupBlock {...props()} />);
      await opens();
    });

    it("keeps a sign-up in the popup on screen, and closing it afterwards records the close", async () => {
      render(<ExitPopupBlock {...props()} />);
      await opens();
      act(() => void window.dispatchEvent(new Event(OPT_IN_DONE_EVENT)));
      expect(dialog()).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(JSON.parse(localStorage.getItem(CLOSED_KEY)!).days).toBe(7);
    });

    it("a visitor on a device it is hidden on", async () => {
      stubDevice({ wide: false, mouse: false });
      render(<ExitPopupBlock {...props({ hideOnMobile: true })} />);
      await staysShut(DELAY_DEFAULT * 1000);
      cleanup();
      stubDevice();
      render(<ExitPopupBlock {...props({ hideOnDesktop: true })} />);
      await staysShut(DELAY_DEFAULT * 1000);
    });

    it("a visitor on a phone, when it is set to exit intent alone; with the time as well they get the time", async () => {
      stubDevice({ wide: false, mouse: false });
      render(<ExitPopupBlock {...props({ trigger: "exit" })} />);
      await advance(EXIT_ARM_MS);
      fireEvent.mouseOut(document, { clientY: 0, relatedTarget: null });
      await staysShut(DELAY_DEFAULT * 1000);
      cleanup();
      render(<ExitPopupBlock {...props()} />);
      await opens();
    });
  });

  it("is always shown in the admin preview, to staff who are signed in and have closed it before, and keeps nothing", async () => {
    visit("/admin/pages/spring/preview");
    document.cookie = "sb-abcdefgh-auth-token=session; path=/";
    localStorage.setItem(legacyKey, JSON.stringify({ at: fake.clock.now(), submitted: true }));
    document.documentElement.removeAttribute("data-consent-required");
    render(<ExitPopupBlock {...props()} />);
    await opens();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(JSON.parse(localStorage.getItem(legacyKey)!).submitted).toBe(true);
    expect(localStorage.length).toBe(1);
  });

  it("stops watching when the page goes away", async () => {
    const view = render(<ExitPopupBlock {...props()} />);
    view.unmount();
    await staysShut(DELAY_DEFAULT * 1000);
    fireEvent.mouseOut(document, { clientY: 0, relatedTarget: null });
    expect(dialog()).toBeNull();
  });

  it("takes the page frame's style classes onto the window, so buttons and colours look as on the page", async () => {
    render(
      <div data-lp-frame className="@container relative lp-primary-teal landing-light lp-bg-cream bg-page">
        <ExitPopupBlock {...props()} />
      </div>,
    );
    await opens();
    const overlay = document.querySelector("[data-exit-popup]") as HTMLElement;
    expect(overlay).toHaveClass("lp-primary-teal", "landing-light", "lp-bg-cream");
    expect(overlay).not.toHaveClass("bg-page");
  });
});

describe("trapTab", () => {
  afterEach(() => document.body.replaceChildren());

  it("keeps the focus on a box that has nothing in it to reach, and leaves the other keys alone", () => {
    const box = document.createElement("div");
    box.tabIndex = -1;
    document.body.append(box);
    const event = { key: "Tab", shiftKey: false, preventDefault: vi.fn() };
    expect(trapTab(event, box)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(box).toHaveFocus();
    expect(trapTab({ ...event, key: "Enter" }, box)).toBe(false);
  });
});

describe("Exit popup in the editor", () => {
  afterEach(() => {
    cleanup();
    setEditingPopup(false);
  });

  it("is a bar with what the settings say, and its blocks only while Edit popup is on", async () => {
    render(
      <>
        <EditPopupField />
        <ExitPopupBlock {...props({ enabled: false })} editing />
      </>,
    );
    expect(screen.getByText(/Exit popup: off/)).toBeInTheDocument();
    expect(screen.getByText(/Shows after 10 seconds, or when a visitor on a computer goes to leave/)).toBeInTheDocument();
    expect(screen.queryByText("Join the list")).toBeNull();
    await userEvent.click(screen.getByRole("switch"));
    expect(screen.getByText("Join the list")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch"));
    expect(screen.queryByText("Join the list")).toBeNull();
  });

  it("draws the popup's own box, in the colour and width chosen, and says when it is on", () => {
    setEditingPopup(true);
    render(
      <ExitPopupEditing enabled summary="Shows soon." boxClass="max-w-sm bg-plum-700 text-white">
        <p>Inside</p>
      </ExitPopupEditing>,
    );
    expect(screen.getByText(/Exit popup: on/)).toBeInTheDocument();
    expect(screen.getByText("Inside").closest(".max-w-sm")).toHaveClass("bg-plum-700", "text-white");
  });

  it("never opens a window or watches anything while editing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      render(<ExitPopupBlock {...props()} editing />);
      await advance(DELAY_DEFAULT * 1000 * 3);
      expect(dialog()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
