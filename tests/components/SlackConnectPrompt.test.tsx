// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let pathname = "/dashboard";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import SlackConnectPrompt from "@/components/SlackConnectPrompt";

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  cleanup();
  pathname = "/dashboard";
});

describe("SlackConnectPrompt", () => {
  it.each([
    ["connect", /needs your Slack account/, "Connect Slack"],
    ["reconnect", /connection stopped working/, "Reconnect Slack"],
    ["update", /reconnect Slack once/, "Reconnect Slack"],
  ] as const)("for %s says why chat is closed and offers the way back", (need, text, action) => {
    render(<SlackConnectPrompt need={need} />);
    expect(screen.getByRole("region", { name: "Slack connection" })).toHaveTextContent(text);
    expect(screen.getByRole("link", { name: action })).toHaveAttribute("href", "/api/oauth/slack/start");
  });

  it("goes away for the session when dismissed, and stays away on the next page", async () => {
    const { unmount } = render(<SlackConnectPrompt need="connect" />);
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("region", { name: "Slack connection" })).not.toBeInTheDocument();
    unmount();

    render(<SlackConnectPrompt need="connect" />);
    expect(screen.queryByRole("region", { name: "Slack connection" })).not.toBeInTheDocument();
  });

  it("isn't shown in Settings, where the Slack panel says the same with its own button", () => {
    pathname = "/settings/preferences";
    render(<SlackConnectPrompt need="connect" />);
    expect(screen.queryByRole("region", { name: "Slack connection" })).not.toBeInTheDocument();
  });
});
