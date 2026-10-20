// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import CalendarKeyboardNav from "@/components/CalendarKeyboardNav";

const props = { prevHref: "/prev", nextHref: "/next", todayHref: "/today" };

describe("CalendarKeyboardNav", () => {
  beforeEach(() => push.mockClear());

  it.each([
    ["p", "/prev"],
    ["k", "/prev"],
    ["n", "/next"],
    ["j", "/next"],
    ["t", "/today"],
  ])("%s goes to %s", (key, href) => {
    render(<CalendarKeyboardNav {...props} />);
    fireEvent.keyDown(window, { key });
    expect(push).toHaveBeenCalledWith(href);
  });

  it("does nothing for next when there is no next week", () => {
    render(<CalendarKeyboardNav {...props} nextHref={null} />);
    fireEvent.keyDown(window, { key: "n" });
    expect(push).not.toHaveBeenCalled();
  });

  it("ignores modified keys and typing in inputs", () => {
    render(
      <>
        <input data-testid="field" />
        <CalendarKeyboardNav {...props} />
      </>
    );
    fireEvent.keyDown(window, { key: "t", metaKey: true });
    fireEvent.keyDown(document.querySelector("input")!, { key: "t" });
    expect(push).not.toHaveBeenCalled();
  });
});
