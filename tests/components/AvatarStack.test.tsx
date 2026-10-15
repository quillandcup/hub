// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import AvatarStack from "@/components/AvatarStack";

const people = ["Fern", "Gale", "Bramble", "Moss"].map((name) => ({ name, photoUrl: null }));

describe("AvatarStack", () => {
  it("renders nothing for nobody", () => {
    const { container } = render(<AvatarStack people={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows up to max people, each titled with their name, and is hidden from assistive tech", () => {
    const { container } = render(<AvatarStack people={people} max={3} />);
    expect([...container.querySelectorAll("[title]")].map((e) => e.getAttribute("title"))).toEqual(["Fern", "Gale", "Bramble"]);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("adds a +N chip for the rest only when asked", () => {
    expect(render(<AvatarStack people={people} max={3} />).queryByText("+1")).not.toBeInTheDocument();
    expect(render(<AvatarStack people={people} max={3} overflow />).getByText("+1")).toBeInTheDocument();
  });
});
