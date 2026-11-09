// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const replace = vi.fn();
let slackParam: string | null = null;
let nextParam: string | null = null;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams({ ...(slackParam ? { slack: slackParam } : {}), ...(nextParam ? { next: nextParam } : {}) }),
}));
vi.mock("@/app/(member)/settings/slackConnectActions", () => ({ disconnectSlackAction: vi.fn() }));
import { disconnectSlackAction } from "@/app/(member)/settings/slackConnectActions";
import SlackConnectPanel from "@/app/(member)/settings/SlackConnectPanel";

beforeEach(() => {
  cleanup();
  replace.mockReset();
  slackParam = null;
  nextParam = null;
  vi.mocked(disconnectSlackAction).mockReset();
});

describe("SlackConnectPanel", () => {
  it("offers to connect, and says what changes", () => {
    render(<SlackConnectPanel connected={false} />);
    expect(screen.getByRole("link", { name: "Connect Slack" })).toHaveAttribute("href", "/api/oauth/slack/start");
    expect(screen.getByText(/Hub Chat needs your Slack account/)).toBeInTheDocument();
  });

  it("asks a connection made before read sync to reconnect, and says read state is shared once it has", () => {
    render(<SlackConnectPanel connected sharesReadState={false} />);
    expect(screen.getByRole("link", { name: "Reconnect Slack" })).toHaveAttribute("href", "/api/oauth/slack/start");
    cleanup();

    render(<SlackConnectPanel connected sharesReadState />);
    expect(screen.queryByRole("link", { name: "Reconnect Slack" })).not.toBeInTheDocument();
    expect(screen.getByText(/marked read in the other/)).toBeInTheDocument();
  });

  it("asks a connection without the direct message permissions to reconnect, and says the Hub doesn't read them", () => {
    render(<SlackConnectPanel connected sharesReadState hasDmScopes={false} />);
    expect(screen.getByRole("link", { name: "Reconnect Slack" })).toHaveAttribute("href", "/api/oauth/slack/start");
    expect(screen.getByText(/uses it only for the DM bridge/)).toBeInTheDocument();
    cleanup();

    render(<SlackConnectPanel connected sharesReadState hasDmScopes />);
    expect(screen.queryByRole("link", { name: "Reconnect Slack" })).not.toBeInTheDocument();
  });

  it("shows the outcome Slack sent the member back with", () => {
    slackParam = "connected";
    render(<SlackConnectPanel connected />);
    expect(screen.getByRole("status")).toHaveTextContent("Your Slack account is connected.");
    cleanup();

    slackParam = "required";
    render(<SlackConnectPanel connected={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("Chat needs your Slack account connected");
    cleanup();

    slackParam = "taken";
    render(<SlackConnectPanel connected={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("already connected to another member");
  });

  it("disconnects and clears the outcome from the URL", async () => {
    vi.mocked(disconnectSlackAction).mockResolvedValue({ ok: true });
    render(<SlackConnectPanel connected />);
    await userEvent.click(screen.getByRole("button", { name: "Disconnect Slack" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/settings"));
  });

  it("says why a disconnect failed", async () => {
    vi.mocked(disconnectSlackAction).mockResolvedValue({ ok: false, error: "Couldn't disconnect. Try again." });
    render(<SlackConnectPanel connected />);
    await userEvent.click(screen.getByRole("button", { name: "Disconnect Slack" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't disconnect");
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("SlackConnectPanel privacy link", () => {
  it("links to the privacy page, connected or not", () => {
    render(<SlackConnectPanel connected={false} />);
    expect(screen.getByRole("link", { name: /what staff can and can't see/ })).toHaveAttribute("href", "/privacy");
    cleanup();

    render(<SlackConnectPanel connected />);
    expect(screen.getByRole("link", { name: /what staff can and can't see/ })).toHaveAttribute("href", "/privacy");
  });

  // The connect-Slack gate (lib/gates.ts): chat sent them here with the page they were headed to.
  describe("when the connect-Slack gate sent the member here", () => {
    const DESTINATION = "/chat/chn_AAAAAAAAAAA1?thread=msg_AAAAAAAAAAA1";

    it("says why, carries the page they asked for to Slack and back, and offers a way out", () => {
      slackParam = "required";
      nextParam = DESTINATION;
      render(<SlackConnectPanel connected={false} />);

      expect(screen.getByRole("status")).toHaveTextContent("Chat needs your Slack account connected");
      expect(screen.getByRole("link", { name: "Connect Slack" })).toHaveAttribute("href", `/api/oauth/slack/start?next=${encodeURIComponent(DESTINATION)}`);
      expect(screen.getByRole("link", { name: /Not now, go to your dashboard/ })).toHaveAttribute("href", "/dashboard");
    });

    it("carries it through a reconnect too, which is what a connection without the read scopes needs", () => {
      slackParam = "required";
      nextParam = DESTINATION;
      render(<SlackConnectPanel connected sharesReadState={false} />);

      expect(screen.getByRole("link", { name: "Reconnect Slack" })).toHaveAttribute("href", `/api/oauth/slack/start?next=${encodeURIComponent(DESTINATION)}`);
      expect(screen.getByRole("link", { name: /Not now/ })).toBeInTheDocument();
    });

    it("still offers the way out when there is no destination, and connects as usual", () => {
      slackParam = "required";
      render(<SlackConnectPanel connected={false} />);

      expect(screen.getByRole("link", { name: "Connect Slack" })).toHaveAttribute("href", "/api/oauth/slack/start");
      expect(screen.getByRole("link", { name: /Not now/ })).toBeInTheDocument();
    });

    it("ignores a destination that isn't a safe same-origin path", () => {
      slackParam = "required";
      nextParam = "https://evil.example.com/";
      render(<SlackConnectPanel connected={false} />);

      expect(screen.getByRole("link", { name: "Connect Slack" })).toHaveAttribute("href", "/api/oauth/slack/start");
    });

    it("shows neither the exit nor the destination on an ordinary visit to Settings", () => {
      nextParam = DESTINATION;
      render(<SlackConnectPanel connected={false} />);

      expect(screen.queryByRole("link", { name: /Not now/ })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Connect Slack" })).toHaveAttribute("href", "/api/oauth/slack/start");
    });
  });
});
