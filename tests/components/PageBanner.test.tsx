// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import PageBanner from "@/components/PageBanner";

describe("PageBanner", () => {
  it("is a status strip in the same plum as the notification banners", () => {
    render(<PageBanner>You are previewing</PageBanner>);
    const banner = screen.getByRole("status");

    expect(banner).toHaveTextContent("You are previewing");
    expect(banner).toHaveClass("border-b", "border-plum-700", "bg-plum-600", "text-white");
  });
});
