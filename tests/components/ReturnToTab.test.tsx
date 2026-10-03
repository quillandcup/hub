// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
let searchParams = new URLSearchParams();
let pathname = "/my-prickles";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams,
  usePathname: () => pathname,
}));

import { ReturnToTabLink, RememberTabUrl } from "@/components/ReturnToTab";

beforeEach(() => {
  push.mockReset();
  sessionStorage.clear();
  searchParams = new URLSearchParams();
  pathname = "/my-prickles";
});

function renderBackLink() {
  render(
    <ReturnToTabLink path="/my-prickles" fallbackHref="/my-prickles/history">
      ← Back to My Prickles
    </ReturnToTabLink>
  );
  return screen.getByRole("link", { name: "← Back to My Prickles" });
}

describe("ReturnToTabLink", () => {
  it("returns to the My Prickles tab the member was last on", async () => {
    pathname = "/my-prickles/all";
    render(<RememberTabUrl path="/my-prickles" />);

    await userEvent.click(renderBackLink());

    expect(push).toHaveBeenCalledWith("/my-prickles/all");
  });

  it("keeps the tab's query (e.g. All Prickles in commit mode)", async () => {
    pathname = "/my-prickles/all";
    searchParams = new URLSearchParams("commit=t1");
    render(<RememberTabUrl path="/my-prickles" />);

    await userEvent.click(renderBackLink());

    expect(push).toHaveBeenCalledWith("/my-prickles/all?commit=t1");
  });

  it("follows the fallback href when no My Prickles visit is remembered", async () => {
    const link = renderBackLink();
    expect(link).toHaveAttribute("href", "/my-prickles/history");

    await userEvent.click(link);

    expect(push).not.toHaveBeenCalled();
  });

  it("doesn't use a URL remembered for a different page", async () => {
    pathname = "/projects/books";
    render(<RememberTabUrl path="/projects" />);

    await userEvent.click(renderBackLink());

    expect(push).not.toHaveBeenCalled();
  });

  it("ignores a stored value that isn't a My Prickles URL", async () => {
    sessionStorage.setItem("returnToTab:/my-prickles", "https://evil.example/my-prickles");

    await userEvent.click(renderBackLink());

    expect(push).not.toHaveBeenCalled();
  });
});
