// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TabBar } from "@/components/Tabs";

describe("TabBar", () => {
  it("scrolls on its own and keeps the scroll from chaining to the page", () => {
    render(<TabBar tabs={[{ id: "a", label: "A" }]} activeTab="a" onTabChange={() => {}} />);
    const list = screen.getByRole("tablist");
    expect(list).toHaveClass("overflow-x-auto");
    expect(list).toHaveClass("overscroll-x-contain");
  });
});
