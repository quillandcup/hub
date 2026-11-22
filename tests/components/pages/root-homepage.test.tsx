// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { APP_URL, JOIN_URL, KAJABI_LOGIN_URL, ROOT_HOST } from "@/lib/config";

const state = vi.hoisted(() => ({ host: "" as string, user: null as { id: string } | null }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: state.host }) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => state.user }));
const redirect = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));

import Home from "@/app/page";
import RootHomepage from "@/components/site/RootHomepage";

beforeEach(() => {
  redirect.mockClear();
  state.user = null;
});

describe("RootHomepage", () => {
  it("has a Join link, a Member login link to the Hub, and a Kajabi sign-in note", () => {
    render(<RootHomepage />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Join" })).toHaveAttribute("href", JOIN_URL);
    expect(screen.getByRole("link", { name: "Member login" })).toHaveAttribute("href", `${APP_URL}/login`);
    expect(screen.getByText(/Still on Kajabi\?/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in there" })).toHaveAttribute("href", KAJABI_LOGIN_URL);
  });
});

describe("the home route", () => {
  it("shows the public homepage on the root host, whoever asks, without checking a session", async () => {
    state.host = ROOT_HOST;
    state.user = { id: "u1" };
    render(await Home());
    expect(screen.getByRole("link", { name: "Join" })).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("keeps sending a signed-in member to the dashboard on the app host", async () => {
    state.host = new URL(APP_URL).host;
    state.user = { id: "u1" };
    await expect(Home()).rejects.toThrow("NEXT_REDIRECT:/dashboard");
  });

  it("keeps sending a signed-out visitor to login on the app host", async () => {
    state.host = new URL(APP_URL).host;
    await expect(Home()).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
