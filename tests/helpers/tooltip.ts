import { fireEvent, screen } from "@testing-library/react";
import { vi } from "vitest";

/**
 * The text of a control's Tooltip: focuses it the way a keyboard does (jsdom has no `:focus-visible`, so the match is
 * stubbed for the call), reads the tip, and blurs again. `null` when the control has no tooltip (or an empty one).
 */
export function tooltipText(control: Element): string | null {
  const real = Element.prototype.matches;
  const spy = vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector: string) {
    return selector === ":focus-visible" ? true : real.call(this, selector);
  });
  try {
    fireEvent.focus(control);
    const text = screen.queryByRole("tooltip")?.textContent ?? null;
    fireEvent.blur(control);
    return text;
  } finally {
    spy.mockRestore();
  }
}
