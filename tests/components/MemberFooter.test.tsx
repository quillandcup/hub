// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SUPPORT_EMAIL } from "@/lib/config";

let pathname = "/dashboard";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import MemberFooter from "@/components/MemberFooter";

afterEach(() => {
  cleanup();
  pathname = "/dashboard";
});

describe("MemberFooter", () => {
  it("has a way to reach us, and Privacy when the page is on for the member", () => {
    render(<MemberFooter showPrivacy />);
    const footer = screen.getByRole("navigation", { name: "Footer" });
    expect(footer).toContainElement(screen.getByRole("link", { name: "Privacy" }));
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Contact us" })).toHaveAttribute("href", `mailto:${SUPPORT_EMAIL}`);
  });

  it("leaves Privacy out while it is off, since the page would redirect", () => {
    render(<MemberFooter showPrivacy={false} />);
    expect(screen.queryByRole("link", { name: "Privacy" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contact us" })).toBeInTheDocument();
  });

  it("is not shown in chat, which fills the window and links Privacy from its own sidebar", () => {
    for (const path of ["/chat", "/chat/abc", "/chat/abc/members"]) {
      pathname = path;
      const { container } = render(<MemberFooter showPrivacy />);
      expect(container).toBeEmptyDOMElement();
      cleanup();
    }
    pathname = "/chatty";
    render(<MemberFooter showPrivacy />);
    expect(screen.getByRole("navigation", { name: "Footer" })).toBeInTheDocument();
  });
});
