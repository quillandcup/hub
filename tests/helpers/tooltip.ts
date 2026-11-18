import { fireEvent, screen } from "@testing-library/react";
import { vi } from "vitest";

/**
 * The text of a control's Tooltip: focuses it the way a keyboard does (jsdom has no `:focus-visible`, so the match is
 * stubbed for the call), reads the tip the control itself is described by (a Tooltip further up that the focus bubbled to
 * doesn't count), and blurs again. `null` when the element has no tooltip of its own (or an empty one).
 */
export function tooltipText(control: Element): string | null {
  const real = Element.prototype.matches;
  const spy = vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector: string) {
    return selector === ":focus-visible" ? true : real.call(this, selector);
  });
  try {
    fireEvent.focus(control);
    const ids = (control.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
    const tip = screen.queryAllByRole("tooltip").find((t) => t.id && ids.includes(t.id));
    const text = tip?.textContent ?? null;
    fireEvent.blur(control);
    return text;
  } finally {
    spy.mockRestore();
  }
}

/** Every element under `root` that has a Tooltip of its own, with its text (document order). */
export function tooltipTexts(root: ParentNode = document.body): { el: Element; text: string }[] {
  return [...root.querySelectorAll("*")].flatMap((el) => {
    const text = tooltipText(el);
    return text === null ? [] : [{ el, text }];
  });
}
