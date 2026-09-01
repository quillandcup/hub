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

const currentSession = {
  id: "session-current",
  created_at: "2026-08-20T10:00:00.000Z",
  updated_at: "2026-08-27T09:00:00.000Z",
  refreshed_at: "2026-08-27T09:00:00.000Z",
  not_after: null,
  user_agent: "Chrome on macOS",
  ip: "1.2.3.4",
  is_current: true,
};

const otherSession = {
  id: "session-other",
  created_at: "2026-08-15T10:00:00.000Z",
  updated_at: "2026-08-16T10:00:00.000Z",
  refreshed_at: "2026-08-16T10:00:00.000Z",
  not_after: null,
  user_agent: "Safari on iPhone",
  ip: "5.6.7.8",
  is_current: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SessionsPanel", () => {
  it("loads and renders sessions, marking the current one", async () => {
    vi.mocked(getMySessions).mockResolvedValue({
      sessions: [currentSession, otherSession],
    });

    render(<SessionsPanel />);

    await waitFor(() => expect(screen.getByText("Chrome on macOS")).toBeInTheDocument());
    expect(screen.getByText("Safari on iPhone")).toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
  });

  it("disables revoke for the current session but not for others", async () => {
    vi.mocked(getMySessions).mockResolvedValue({
      sessions: [currentSession, otherSession],
    });

    render(<SessionsPanel />);
    await waitFor(() => expect(screen.getByText("Chrome on macOS")).toBeInTheDocument());

    const signOutButtons = screen.getAllByRole("button", { name: /sign out$/i });
    expect(signOutButtons).toHaveLength(2);
    expect(signOutButtons[0]).toBeDisabled(); // current session, listed first (most recently active)
    expect(signOutButtons[1]).not.toBeDisabled();
  });

  it("revokes a single session and refreshes the list", async () => {
    vi.mocked(getMySessions)
      .mockResolvedValueOnce({ sessions: [currentSession, otherSession] })
      .mockResolvedValueOnce({ sessions: [currentSession] });
    vi.mocked(revokeSession).mockResolvedValue({ success: true });

    render(<SessionsPanel />);
    await waitFor(() => expect(screen.getByText("Safari on iPhone")).toBeInTheDocument());

    await userEvent.click(screen.getAllByRole("button", { name: /sign out$/i })[1]);

    await waitFor(() => expect(revokeSession).toHaveBeenCalledWith("session-other"));
    await waitFor(() => expect(screen.queryByText("Safari on iPhone")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("Session signed out.");
  });

  it("shows an error and does not reload when revoke fails", async () => {
    vi.mocked(getMySessions).mockResolvedValue({
      sessions: [currentSession, otherSession],
    });
    vi.mocked(revokeSession).mockResolvedValue({ error: "That session was already signed out" });

    render(<SessionsPanel />);
    await waitFor(() => expect(screen.getByText("Safari on iPhone")).toBeInTheDocument());

    await userEvent.click(screen.getAllByRole("button", { name: /sign out$/i })[1]);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("That session was already signed out")
    );
    expect(getMySessions).toHaveBeenCalledTimes(1); // no reload on failure
  });

  it("signs out of all other sessions via the bulk action", async () => {
    vi.mocked(getMySessions)
      .mockResolvedValueOnce({ sessions: [currentSession, otherSession] })
      .mockResolvedValueOnce({ sessions: [currentSession] });
    vi.mocked(signOutOtherSessions).mockResolvedValue({ success: true });

    render(<SessionsPanel />);
    await waitFor(() => expect(screen.getByText("Safari on iPhone")).toBeInTheDocument());

    await userEvent.click(
      screen.getByRole("button", { name: "Sign out of all other sessions" })
    );

    await waitFor(() => expect(signOutOtherSessions).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Signed out of all other sessions.")
    );
    expect(screen.queryByText("Safari on iPhone")).not.toBeInTheDocument();
  });

  it("disables the bulk action when there are no other sessions", async () => {
    vi.mocked(getMySessions).mockResolvedValue({ sessions: [currentSession] });

    render(<SessionsPanel />);
    await waitFor(() => expect(screen.getByText("Chrome on macOS")).toBeInTheDocument());

    expect(
      screen.getByRole("button", { name: "Sign out of all other sessions" })
    ).toBeDisabled();
  });

  it("shows an error message when loading sessions fails", async () => {
    vi.mocked(getMySessions).mockResolvedValue({ error: "boom" });

    render(<SessionsPanel />);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("boom"));
  });
});
