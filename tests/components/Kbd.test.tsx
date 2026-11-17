// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderToString } from "react-dom/server";
import Kbd, { keyLabel } from "@/components/Kbd";
import CalendarWeekNav from "@/components/CalendarWeekNav";
import Modal from "@/components/Modal";

function setPlatform(platform: string) {
  vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Kbd", () => {
  it("draws mod as Command on Apple platforms", () => {
    setPlatform("MacIntel");
    const { container } = render(<Kbd keys={["mod", "K"]} />);
    expect([...container.querySelectorAll("kbd")].map((k) => k.textContent)).toEqual(["⌘", "K"]);
  });

  it("draws mod as Ctrl elsewhere", () => {
    setPlatform("Win32");
    const { container } = render(<Kbd keys={["mod", "K"]} />);
    expect([...container.querySelectorAll("kbd")].map((k) => k.textContent)).toEqual(["Ctrl", "K"]);
  });

  it("renders the neutral default (Ctrl) on the server, so hydration matches", () => {
    setPlatform("MacIntel");
    expect(renderToString(<Kbd keys={["mod"]} />)).toContain("Ctrl");
  });

  it("maps key names and upper-cases single letters", () => {
    expect(keyLabel("enter", false)).toBe("↵");
    expect(keyLabel("esc", false)).toBe("Esc");
    expect(keyLabel("up", false)).toBe("↑");
    expect(keyLabel("down", false)).toBe("↓");
    expect(keyLabel("shift", true)).toBe("⇧");
    expect(keyLabel("shift", false)).toBe("Shift");
    expect(keyLabel("t", false)).toBe("T");
    expect(keyLabel("F2", false)).toBe("F2");
  });

  it("is decorative and hidden on small screens and touch devices", () => {
    const { container } = render(<Kbd keys={["esc"]} />);
    const hint = container.querySelector("[data-kbd]")!;
    expect(hint).toHaveAttribute("aria-hidden", "true");
    expect(hint.className).toContain("hidden");
    expect(hint.className).toContain("fine-pointer:sm:inline-flex");
  });
});

describe("Kbd where it is used", () => {
  it("Modal's close button shows Esc and declares the shortcut", () => {
    const { getByRole } = render(<Modal isOpen onClose={() => {}} title="Stats">body</Modal>);
    const close = getByRole("button", { name: "Close" });
    expect(close).toHaveAttribute("aria-keyshortcuts", "Escape");
    expect(close.querySelector("kbd")).toHaveTextContent("Esc");
  });

  it("the calendar week links show t, p and n", () => {
    const { getByRole } = render(<CalendarWeekNav todayHref="/c" prevHref="/c?week=a" nextHref="/c?week=b" />);
    expect(getByRole("link", { name: "Today" }).querySelector("kbd")).toHaveTextContent("T");
    expect(getByRole("link", { name: "← Previous" }).querySelector("kbd")).toHaveTextContent("P");
    expect(getByRole("link", { name: "Next →" }).querySelector("kbd")).toHaveTextContent("N");
  });
});
