// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PrickleDescription from "@/components/PrickleDescription";

describe("PrickleDescription", () => {
  it("renders bold and keeps line breaks", () => {
    const { container } = render(<PrickleDescription markdown={"**Members Only**\nLine two"} />);
    expect(screen.getByText("Members Only").tagName).toBe("STRONG");
    expect(container.querySelector("p")?.className).toContain("whitespace-pre-line");
  });

  it("opens links safely and drops unsafe ones and raw HTML", () => {
    render(<PrickleDescription markdown={"[ok](https://example.com) [bad](javascript:alert(1)) <script>x</script>"} />);
    const link = screen.getByRole("link", { name: "ok" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.queryByRole("link", { name: "bad" })).toBeNull();
  });

  it("renders lists with bullets", () => {
    const { container } = render(<PrickleDescription markdown={"- one\n- two"} />);
    expect(container.querySelector("ul")?.className).toContain("list-disc");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("links a bare URL", () => {
    render(<PrickleDescription markdown={"Join Zoom Meeting\nhttps://example.com/j/1?pwd=x"} />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://example.com/j/1?pwd=x");
  });
});
