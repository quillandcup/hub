// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnimationsController } from "@/components/AnimationsController";
import { AnimationsSwitcher } from "@/app/(member)/settings/AnimationsSwitcher";
import { ANIMATIONS_STORAGE_KEY } from "@/lib/animations";

/** A matchMedia for the reduced-motion query whose answer a test can change and announce. */
function mockMotion(reduce: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches: reduce,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    fire: () => listeners.forEach((fn) => fn()),
  };
  window.matchMedia = vi.fn().mockReturnValue(media) as unknown as typeof window.matchMedia;
  return media;
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.animations;
});
afterEach(cleanup);

describe("Animations choice", () => {
  const both = (
    <>
      <AnimationsController />
      <AnimationsSwitcher />
    </>
  );

  it("is System by default (device allows motion), and each choice marks the page and is remembered", async () => {
    mockMotion(false);
    render(both);
    const select = await screen.findByRole("combobox", { name: "Animations" });
    expect(select).toHaveValue("system");
    expect(screen.getByText(/currently off, so they move/)).toBeInTheDocument();
    expect(document.documentElement.dataset.animations).toBe("on");

    await userEvent.selectOptions(select, "reduce");
    expect(localStorage.getItem(ANIMATIONS_STORAGE_KEY)).toBe("reduce");
    expect(document.documentElement.dataset.animations).toBe("off");

    await userEvent.selectOptions(select, "allow");
    expect(localStorage.getItem(ANIMATIONS_STORAGE_KEY)).toBe("allow");
    expect(document.documentElement.dataset.animations).toBe("on");

    // System stores nothing: back to the initial state.
    await userEvent.selectOptions(select, "system");
    expect(localStorage.getItem(ANIMATIONS_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.dataset.animations).toBe("on");
  });

  it("System follows a device that asks for reduced motion, and a change in the device while open", async () => {
    const media = mockMotion(true);
    render(both);
    expect(await screen.findByRole("combobox", { name: "Animations" })).toHaveValue("system");
    expect(screen.getByText(/currently on, so GIFs and emoji are still/)).toBeInTheDocument();
    expect(document.documentElement.dataset.animations).toBe("off");

    // The device setting changes while the page is open: the page and the note follow.
    media.matches = false;
    act(() => media.fire());
    await waitFor(() => expect(document.documentElement.dataset.animations).toBe("on"));
    expect(screen.getByText(/currently off, so they move/)).toBeInTheDocument();
  });

  it("an explicit choice ignores the device, and Allow keeps motion on a reduced-motion device", async () => {
    mockMotion(true);
    localStorage.setItem(ANIMATIONS_STORAGE_KEY, "allow");
    render(both);
    expect(await screen.findByRole("combobox", { name: "Animations" })).toHaveValue("allow");
    expect(document.documentElement.dataset.animations).toBe("on");
  });

  it("restores a GIF's source when animations come back", async () => {
    mockMotion(false);
    localStorage.setItem(ANIMATIONS_STORAGE_KEY, "reduce");
    // jsdom never loads images: the probe stays pending, so only the bookkeeping is visible.
    document.body.innerHTML = '<img id="g" src="https://x.test/party.gif" alt=":party:">';
    render(both);
    const img = document.getElementById("g") as HTMLImageElement;
    expect(img.getAttribute("data-frozen-src")).toBe("https://x.test/party.gif");
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Animations" }), "allow");
    expect(img.hasAttribute("data-frozen-src")).toBe(false);
    expect(img.getAttribute("src")).toBe("https://x.test/party.gif");
  });
});

describe("click to play", () => {
  it("shows Play on a GIF attachment only while animations are off, and toggles it", async () => {
    mockMotion(false);
    localStorage.setItem(ANIMATIONS_STORAGE_KEY, "reduce");
    const { default: MessageFiles } = await import("@/components/chat/MessageFiles");
    render(
      <>
        <AnimationsController />
        <MessageFiles
          messageId="m1"
          files={[{ id: "F1", name: "demo1.gif", mimetype: "image/gif", size: 1, width: 10, height: 10 }]}
          canDelete={false}
        />
      </>,
    );
    const play = await screen.findByRole("button", { name: /play demo1\.gif/i });
    expect(screen.getByRole("button", { name: /expand demo1\.gif/i })).toBeInTheDocument();
    await userEvent.click(play);
    expect(screen.getByAltText("demo1.gif")).toHaveAttribute("data-playing");
    await userEvent.click(screen.getByRole("button", { name: /pause demo1\.gif/i }));
    expect(screen.getByAltText("demo1.gif")).not.toHaveAttribute("data-playing");
  });
});

describe("freezing images", () => {
  it("freezes a pause back to a still and never restores a non-http address", async () => {
    mockMotion(false);
    localStorage.setItem(ANIMATIONS_STORAGE_KEY, "reduce");
    document.body.innerHTML = '<img id="e" src="https://x.test/party.gif" alt=":party:"><img id="p" src="/api/chat/files/m/F1" data-animated alt="p">';
    render(<AnimationsController />);
    const emoji = document.getElementById("e") as HTMLImageElement;
    const attachment = document.getElementById("p") as HTMLImageElement;
    // An emoji by its .gif address and an attachment by its flag are both picked up; a plain image is not.
    expect(emoji.hasAttribute("data-frozen-src")).toBe(true);
    expect(attachment.hasAttribute("data-frozen-src")).toBe(true);

    // Press play on the attachment (data-playing): it is released; remove it (pause): it is frozen again.
    attachment.setAttribute("data-playing", "");
    await waitFor(() => expect(attachment.hasAttribute("data-frozen-src")).toBe(false));
    attachment.removeAttribute("data-playing");
    await waitFor(() => expect(attachment.hasAttribute("data-frozen-src")).toBe(true));

    // The saved address is DOM text: a javascript: value is never put back into src.
    emoji.setAttribute("data-frozen-src", "javascript:alert(1)");
    emoji.setAttribute("src", "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==");
    localStorage.setItem(ANIMATIONS_STORAGE_KEY, "allow");
    window.dispatchEvent(new Event("hub-animations-changed"));
    await waitFor(() => expect(emoji.hasAttribute("data-frozen-src")).toBe(false));
    expect(emoji.getAttribute("src")).not.toContain("javascript:");
  });

  it("keeps an emoji whose host blocks reading its frame (no CORS) as it is, not a broken image", async () => {
    mockMotion(false);
    localStorage.setItem(ANIMATIONS_STORAGE_KEY, "reduce");
    // A host without CORS headers: the probe image fails to load.
    class BlockedImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      crossOrigin = "";
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal("Image", BlockedImage);
    try {
      document.body.innerHTML = '<img id="e" src="https://x.test/party.gif" alt=":party:"><img id="p" src="/api/chat/files/m/F1" data-animated alt="p">';
      render(<AnimationsController />);
      const emoji = document.getElementById("e") as HTMLImageElement;
      const attachment = document.getElementById("p") as HTMLImageElement;
      await waitFor(() => expect(emoji.hasAttribute("data-unfreezable")).toBe(true));
      expect(emoji.getAttribute("src")).toBe("https://x.test/party.gif");
      expect(emoji.hasAttribute("data-frozen-src")).toBe(false);
      // An attachment keeps its tile over a blank frame.
      await waitFor(() => expect(attachment.getAttribute("src")).toMatch(/^data:image\/gif/));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("swaps an emoji that brings its own still to it, and back, without drawing anything", async () => {
    mockMotion(false);
    localStorage.setItem(ANIMATIONS_STORAGE_KEY, "reduce");
    // An apng copy has no animated extension; the still is what marks it.
    document.body.innerHTML = '<img id="e" src="https://cdn.test/abc.png" data-still="https://cdn.test/abc.still.png" alt=":party:">';
    render(<AnimationsController />);
    const emoji = document.getElementById("e") as HTMLImageElement;
    expect(emoji.getAttribute("src")).toBe("https://cdn.test/abc.still.png");
    expect(emoji.getAttribute("data-frozen-src")).toBe("https://cdn.test/abc.png");
    // Swapping the source does not make the controller freeze it again.
    await new Promise((r) => setTimeout(r, 0));
    expect(emoji.getAttribute("src")).toBe("https://cdn.test/abc.still.png");

    localStorage.setItem(ANIMATIONS_STORAGE_KEY, "allow");
    window.dispatchEvent(new Event("hub-animations-changed"));
    await waitFor(() => expect(emoji.getAttribute("src")).toBe("https://cdn.test/abc.png"));
  });

  it("ignores a still that is not an http(s) address", () => {
    mockMotion(false);
    localStorage.setItem(ANIMATIONS_STORAGE_KEY, "reduce");
    document.body.innerHTML = '<img id="e" src="https://cdn.test/a.gif" data-still="javascript:alert(1)" alt=":x:">';
    render(<AnimationsController />);
    const emoji = document.getElementById("e") as HTMLImageElement;
    expect(emoji.getAttribute("src")).not.toContain("javascript:");
  });

  it("leaves ordinary images alone", () => {
    mockMotion(false);
    localStorage.setItem(ANIMATIONS_STORAGE_KEY, "reduce");
    document.body.innerHTML = '<img id="n" src="https://x.test/cover.png" alt="cover">';
    render(<AnimationsController />);
    expect(document.getElementById("n")!.hasAttribute("data-frozen-src")).toBe(false);
  });
});
