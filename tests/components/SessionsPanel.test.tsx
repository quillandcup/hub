// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/(member)/settings/actions", () => ({
  getMySessions: vi.fn(),
  revokeSession: vi.fn(),
  signOutOtherSessions: vi.fn(),
}));

import { SessionsPanel } from "@/app/(member)/settings/SessionsPanel";
import {
  getMySessions,
  revokeSession,
  signOutOtherSessions,
} from "@/app/(member)/settings/actions";

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";
const SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1";
const CHROME_LABEL = "Chrome 156 on macOS";
const SAFARI_LABEL = "Safari on iPhone (iOS 18.7)";

const currentSession = {
  id: "session-current",
  created_at: "2026-08-20T10:00:00.000Z",
  updated_at: "2026-08-27T09:00:00.000Z",
  refreshed_at: "2026-08-27T09:00:00.000Z",
  not_after: null,
  user_agent: CHROME_UA,
  ip: "1.2.3.4",
  is_current: true,
};

const otherSession = {
  id: "session-other",
  created_at: "2026-08-15T10:00:00.000Z",
  updated_at: "2026-08-16T10:00:00.000Z",
  refreshed_at: "2026-08-16T10:00:00.000Z",
  not_after: null,
  user_agent: SAFARI_UA,
  ip: "5.6.7.8",
  is_current: false,
};

const logOut = () => screen.getAllByRole("button", { name: /^log out$/i });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SessionsPanel", () => {
  it("shows friendly device names, the Devices title and the current marker", async () => {
    vi.mocked(getMySessions).mockResolvedValue({ sessions: [currentSession, otherSession] });

    render(<SessionsPanel />);

    await waitFor(() => expect(screen.getByText(CHROME_LABEL)).toBeInTheDocument());
    expect(screen.getByText(SAFARI_LABEL)).toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Devices" })).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent("All devices signed in to your account");
    expect(screen.queryByText(/Mozilla/)).not.toBeInTheDocument();
  });

  it("disables log out for the current device but not for others", async () => {
    vi.mocked(getMySessions).mockResolvedValue({ sessions: [currentSession, otherSession] });

    render(<SessionsPanel />);
    await waitFor(() => expect(screen.getByText(CHROME_LABEL)).toBeInTheDocument());

    expect(logOut()).toHaveLength(2);
    expect(logOut()[0]).toBeDisabled();
    expect(logOut()[1]).not.toBeDisabled();
  });

  it("logs out a single device and refreshes the list", async () => {
    vi.mocked(getMySessions)
      .mockResolvedValueOnce({ sessions: [currentSession, otherSession] })
      .mockResolvedValueOnce({ sessions: [currentSession] });
    vi.mocked(revokeSession).mockResolvedValue({ success: true });

    render(<SessionsPanel />);
    await waitFor(() => expect(screen.getByText(SAFARI_LABEL)).toBeInTheDocument());

    await userEvent.click(logOut()[1]);

    await waitFor(() => expect(revokeSession).toHaveBeenCalledWith("session-other"));
    await waitFor(() => expect(screen.queryByText(SAFARI_LABEL)).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("Device logged out.");
  });

  it("shows an error and does not reload when revoke fails", async () => {
    vi.mocked(getMySessions).mockResolvedValue({ sessions: [currentSession, otherSession] });
    vi.mocked(revokeSession).mockResolvedValue({ error: "That session was already signed out" });

    render(<SessionsPanel />);
    await waitFor(() => expect(screen.getByText(SAFARI_LABEL)).toBeInTheDocument());

    await userEvent.click(logOut()[1]);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("That session was already signed out")
    );
    expect(getMySessions).toHaveBeenCalledTimes(1);
  });

  it("logs out of all other devices via the bulk action", async () => {
    vi.mocked(getMySessions)
      .mockResolvedValueOnce({ sessions: [currentSession, otherSession] })
      .mockResolvedValueOnce({ sessions: [currentSession] });
    vi.mocked(signOutOtherSessions).mockResolvedValue({ success: true });

    render(<SessionsPanel />);
    await waitFor(() => expect(screen.getByText(SAFARI_LABEL)).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Log out of all other devices" }));

    await waitFor(() => expect(signOutOtherSessions).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Logged out of all other devices.")
    );
    expect(screen.queryByText(SAFARI_LABEL)).not.toBeInTheDocument();
  });

  it("disables the bulk action when there are no other devices", async () => {
    vi.mocked(getMySessions).mockResolvedValue({ sessions: [currentSession] });

    render(<SessionsPanel />);
    await waitFor(() => expect(screen.getByText(CHROME_LABEL)).toBeInTheDocument());

    expect(screen.getByRole("button", { name: "Log out of all other devices" })).toBeDisabled();
  });

  it("shows an error message when loading fails", async () => {
    vi.mocked(getMySessions).mockResolvedValue({ error: "boom" });

    render(<SessionsPanel />);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("boom"));
  });

  it("shows the empty state", async () => {
    vi.mocked(getMySessions).mockResolvedValue({ sessions: [] });

    render(<SessionsPanel />);

    await waitFor(() => expect(screen.getByText("No devices found.")).toBeInTheDocument());
  });

  it("lists every device, the rest behind a visible Show N more button", async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ ...otherSession, id: `s${i}` }));
    vi.mocked(getMySessions).mockResolvedValue({ sessions: [currentSession, ...many] });

    render(<SessionsPanel />);
    await waitFor(() => expect(screen.getByText(CHROME_LABEL)).toBeInTheDocument());
    expect(logOut()).toHaveLength(5);

    await userEvent.click(screen.getByRole("button", { name: "Show 4 more" }));
    expect(logOut()).toHaveLength(9);
    expect(screen.queryByRole("button", { name: /show \d+ more/i })).not.toBeInTheDocument();
  });
});
