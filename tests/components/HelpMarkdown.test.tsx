// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import HelpMarkdown from "@/components/help/HelpMarkdown";

describe("HelpMarkdown", () => {
  it("shows an img: screenshot through the signed-in image route, with its alt text", () => {
    render(<HelpMarkdown markdown="![The dashboard](img:join-a-prickle/01-dashboard.png)" />);
    expect(screen.getByRole("img", { name: "The dashboard" })).toHaveAttribute("src", "/help/images/join-a-prickle/01-dashboard.png");
  });

  it("does not load images from anywhere else", () => {
    const { container } = render(
      <HelpMarkdown markdown={"![x](https://example.com/track.png)\n\n![y](img:../../secret.png)\n\n![z](data:image/png;base64,AAAA)"} />,
    );
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  it("keeps web, mail and in-app links and drops scripts", () => {
    render(<HelpMarkdown markdown={"[web](https://example.com) [mail](mailto:a@example.com) [app](/help) [bad](javascript:alert(1))"} />);
    expect(screen.getByRole("link", { name: "web" })).toHaveAttribute("href", "https://example.com");
    expect(screen.getByRole("link", { name: "mail" })).toHaveAttribute("href", "mailto:a@example.com");
    expect(screen.getByRole("link", { name: "app" })).toHaveAttribute("href", "/help");
    expect(screen.getByText("bad").closest("a")?.getAttribute("href") || "").toBe("");
  });

  it("renders tables and lists", () => {
    render(<HelpMarkdown markdown={"- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |"} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});
