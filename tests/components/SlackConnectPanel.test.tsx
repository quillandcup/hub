// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const replace = vi.fn();
let slackParam: string | null = null;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(slackParam ? { slack: slackParam } : {}),
}));
vi.mock("@/app/(member)/settings/slackConnectActions", () => ({ disconnectSlackAction: vi.fn() }));
import { disconnectSlackAction } from "@/app/(member)/settings/slackConnectActions";
import SlackConnectPanel from "@/app/(member)/settings/SlackConnectPanel";

beforeEach(() => {
  cleanup();
  replace.mockReset();
  slackParam = null;
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

  it("asks a connection with the DM permissions but not the reactions one to reconnect once more, for live reactions", () => {
    render(<SlackConnectPanel connected sharesReadState hasDmScopes hasDmReactionScope={false} />);
    expect(screen.getByRole("link", { name: "Reconnect Slack" })).toHaveAttribute("href", "/api/oauth/slack/start");
    expect(screen.getByText(/see reactions in your direct messages as they happen/)).toBeInTheDocument();
    cleanup();

    render(<SlackConnectPanel connected sharesReadState hasDmScopes hasDmReactionScope />);
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
});
