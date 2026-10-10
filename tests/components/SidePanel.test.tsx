// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import SidePanel from "@/components/chat/SidePanel";

const KEY = "chat.sidePanelWidth";

const mount = () =>
  render(
    <div>
      <SidePanel title="Thread" closeHref="/chat/c1">
        <p>the thread</p>
      </SidePanel>
    </div>,
  );
const handle = () => screen.getByRole("separator", { name: "Resize thread" });
const width = () => (screen.getByRole("complementary", { name: "Thread" }) as HTMLElement).style.getPropertyValue("--chat-panel-width");

beforeEach(() => {
  localStorage.clear();
});

describe("SidePanel", () => {
  it("shows its title, content and a close link, and starts at the default width", () => {
    mount();
    expect(screen.getByRole("complementary", { name: "Thread" })).toBeInTheDocument();
    expect(screen.getByText("the thread")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Close thread" })).toHaveAttribute("href", "/chat/c1");
    expect(width()).toBe("384px");
    expect(handle()).toHaveAttribute("aria-valuenow", "384");
  });

  it("widens when the handle is dragged left, and narrows when dragged right, within its limits", () => {
    mount();
    fireEvent.pointerDown(handle(), { clientX: 1000, pointerId: 1 });
    fireEvent.pointerMove(handle(), { clientX: 900, pointerId: 1 });
    expect(width()).toBe("484px");
    fireEvent.pointerMove(handle(), { clientX: 1100, pointerId: 1 });
    expect(width()).toBe("320px"); // never narrower than the minimum
    fireEvent.pointerMove(handle(), { clientX: -5000, pointerId: 1 });
    expect(width()).toBe("900px"); // never wider than the maximum
    fireEvent.pointerUp(handle(), { clientX: -5000, pointerId: 1 });
  });

  it("remembers the width it was left at and restores it next time", () => {
    const { unmount } = mount();
    fireEvent.pointerDown(handle(), { clientX: 1000, pointerId: 1 });
    fireEvent.pointerUp(handle(), { clientX: 800, pointerId: 1 });
    expect(width()).toBe("584px");
    expect(localStorage.getItem(KEY)).toBe("584");
    unmount();

    mount();
    expect(width()).toBe("584px");
  });

  it("ignores a saved width that is not a number, and clamps an out-of-range one", () => {
    localStorage.setItem(KEY, "wide");
    const { unmount } = mount();
    expect(width()).toBe("384px");
    unmount();

    localStorage.setItem(KEY, "5000");
    mount();
    expect(width()).toBe("900px");
  });

  it("resizes from the keyboard: arrows (Shift for bigger steps), Home, End, and Enter or a double-click to reset", () => {
    mount();
    const key = (k: string, shiftKey = false) => act(() => void fireEvent.keyDown(handle(), { key: k, shiftKey }));
    key("ArrowLeft");
    expect(width()).toBe("408px");
    key("ArrowLeft", true);
    expect(width()).toBe("504px");
    key("ArrowRight");
    expect(width()).toBe("480px");
    key("Home");
    expect(width()).toBe("320px");
    key("End");
    expect(width()).toBe("900px");
    key("Enter");
    expect(width()).toBe("384px");

    key("ArrowLeft");
    fireEvent.doubleClick(handle());
    expect(width()).toBe("384px");
    expect(localStorage.getItem(KEY)).toBe("384");
  });

  it("does not swallow other keys", () => {
    mount();
    expect(fireEvent.keyDown(handle(), { key: "a" })).toBe(true);
  });

  it("keeps text from being selected while dragging, and puts that back after", () => {
    mount();
    fireEvent.pointerDown(handle(), { clientX: 1000, pointerId: 1 });
    expect(document.body.style.userSelect).toBe("none");
    fireEvent.pointerUp(handle(), { clientX: 1000, pointerId: 1 });
    expect(document.body.style.userSelect).toBe("");
  });
});
