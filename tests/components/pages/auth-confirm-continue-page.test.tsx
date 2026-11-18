// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ConfirmContinuePage from "@/app/auth/confirm/continue/page";

const HASH = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c";

async function renderPage(params: Record<string, string | string[]>) {
  render(await ConfirmContinuePage({ searchParams: Promise.resolve(params) }));
}
const field = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value;

describe("/auth/confirm/continue", () => {
  it("shows a Continue button that posts the token to /auth/confirm, spending nothing on render", async () => {
    await renderPage({ token_hash: HASH, type: "email", next: "/settings" });
    expect(screen.getByRole("button", { name: "Continue to Hedgie Hub" })).toBeInTheDocument();
    const form = document.querySelector("form")!;
    expect(form).toHaveAttribute("action", "/auth/confirm");
    expect(form.method).toBe("post");
    expect(field("token_hash")).toBe(HASH);
    expect(field("type")).toBe("email");
    expect(field("next")).toBe("/settings");
  });

  it("words the button for an invitation", async () => {
    await renderPage({ token_hash: HASH, type: "invite" });
    expect(screen.getByRole("button", { name: "Accept invitation" })).toBeInTheDocument();
    expect(field("next")).toBeUndefined();
  });

  it("words the button for a recovery link", async () => {
    await renderPage({ token_hash: HASH, type: "recovery" });
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });

  it("drops an unsafe next", async () => {
    await renderPage({ token_hash: HASH, type: "email", next: "//evil.example" });
    expect(field("next")).toBeUndefined();
  });

  it("offers the code instead of a button when the link is incomplete", async () => {
    await renderPage({ type: "email" });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/link isn't complete/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in with a code" })).toHaveAttribute("href", "/login?mode=code");
  });

  it("takes the first value when a parameter is repeated", async () => {
    await renderPage({ token_hash: [HASH, "x"], type: ["email", "y"] });
    expect(field("token_hash")).toBe(HASH);
  });
});
