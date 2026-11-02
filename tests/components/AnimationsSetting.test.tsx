// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnimationsController } from "@/components/AnimationsController";
import { AnimationsToggle } from "@/app/(member)/settings/AnimationsToggle";
import { ANIMATIONS_STORAGE_KEY } from "@/lib/animations";

function mockMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: reduce,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.animations;
});
afterEach(cleanup);

describe("Allow animations", () => {
  it("is checked by default and turning it off marks the page and is remembered", async () => {
    mockMotion(false);
    render(
      <>
        <AnimationsController />
        <AnimationsToggle />
      </>,
    );
    const box = await screen.findByRole("checkbox", { name: /allow animations/i });
    expect(box).toBeChecked();
    expect(document.documentElement.dataset.animations).toBe("on");

    await userEvent.click(box);
    expect(box).not.toBeChecked();
    expect(localStorage.getItem(ANIMATIONS_STORAGE_KEY)).toBe("off");
    expect(document.documentElement.dataset.animations).toBe("off");

    await userEvent.click(box);
    expect(document.documentElement.dataset.animations).toBe("on");
  });

  it("starts off when the device asks for reduced motion", async () => {
    mockMotion(true);
    render(
      <>
        <AnimationsController />
        <AnimationsToggle />
      </>,
    );
    expect(await screen.findByRole("checkbox", { name: /allow animations/i })).not.toBeChecked();
    expect(document.documentElement.dataset.animations).toBe("off");
  });

  it("restores a GIF's source when animations come back", async () => {
    mockMotion(false);
    localStorage.setItem(ANIMATIONS_STORAGE_KEY, "off");
    // jsdom never loads images: the probe stays pending, so only the bookkeeping is visible.
    document.body.innerHTML = '<img id="g" src="https://x.test/party.gif" alt=":party:">';
    render(
      <>
        <AnimationsController />
        <AnimationsToggle />
      </>,
    );
    const img = document.getElementById("g") as HTMLImageElement;
    expect(img.getAttribute("data-frozen-src")).toBe("https://x.test/party.gif");
    await userEvent.click(await screen.findByRole("checkbox", { name: /allow animations/i }));
    expect(img.hasAttribute("data-frozen-src")).toBe(false);
    expect(img.getAttribute("src")).toBe("https://x.test/party.gif");
  });
});

describe("click to play", () => {
  it("shows Play on a GIF attachment only while animations are off, and toggles it", async () => {
    mockMotion(false);
    localStorage.setItem(ANIMATIONS_STORAGE_KEY, "off");
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
