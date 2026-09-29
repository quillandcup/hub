// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { completeSlackSignIn } = vi.hoisted(() => ({ completeSlackSignIn: vi.fn() }));
vi.mock("@/app/auth/slack/actions", () => ({ completeSlackSignIn }));

import SlackSignInContinuePage from "@/app/auth/slack/continue/page";

async function renderPage(params: { token?: string; error?: string; refreshed?: string }) {
  render(await SlackSignInContinuePage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  process.env.SLACK_TEAM_ID = "T1";
  process.env.SLACK_APP_ID = "A1";
});

afterEach(() => {
  delete process.env.SLACK_TEAM_ID;
  delete process.env.SLACK_APP_ID;
});

describe("/auth/slack/continue", () => {
  it("shows a Continue button carrying the token, without spending it on render", async () => {
    await renderPage({ token: "abc123" });

    expect(screen.getByRole("button", { name: "Continue to Hedgie Hub" })).toBeInTheDocument();
    expect(document.querySelector<HTMLInputElement>('input[name="token"]')?.value).toBe("abc123");
    expect(completeSlackSignIn).not.toHaveBeenCalled();
  });

  it("on an expired link, points back into Slack and offers email sign-in", async () => {
    await renderPage({ error: "expired" });

    expect(screen.getByText(/expired or was already used/)).toHaveTextContent(/Open the Hedgie Hub app in Slack/);
    expect(screen.getByRole("link", { name: "Open Hedgie Hub in Slack" })).toHaveAttribute(
      "href",
      "slack://app?team=T1&id=A1&tab=home"
    );
    expect(screen.getByRole("link", { name: "Sign in by email" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("says when a fresh button is already waiting in Slack", async () => {
    await renderPage({ error: "expired", refreshed: "1" });
    expect(screen.getByText(/We've put a fresh button/)).toBeInTheDocument();
  });

  it("omits the Slack link when the app isn't configured", async () => {
    delete process.env.SLACK_APP_ID;
    await renderPage({ error: "expired" });
    expect(screen.queryByRole("link", { name: "Open Hedgie Hub in Slack" })).not.toBeInTheDocument();
  });

  it("treats a missing token as expired", async () => {
    await renderPage({});
    expect(screen.getByText(/expired or was already used/)).toBeInTheDocument();
  });

  it("falls back to a generic message for unknown error codes", async () => {
    await renderPage({ error: "<script>" });
    expect(screen.getByText(/Something went wrong signing you in/)).toBeInTheDocument();
  });
});
