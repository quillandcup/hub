// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OptInFormBlock } from "@/components/landing/blocks";
import { checkLandingPage } from "@/lib/landing/a11y";

const base = { kajabiFormId: "form-123", instagramField: "custom_1" as const, buttonLabel: "Join the list", reassurance: "No spam.", successMessage: "You're in!", href: "", look: "solid" as const, color: "plum" as const, shape: "pill" as const };

function visit(path: string) {
  window.history.pushState({}, "", path);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  visit("/");
});

describe("OptInFormBlock", () => {
  it("shows nothing to a visitor when no Kajabi form is chosen", () => {
    const { container } = render(<OptInFormBlock {...base} kajabiFormId=" " />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the fields, the button label and the reassurance line, and asks for Instagram only when the block keeps it", () => {
    const { rerender } = render(<OptInFormBlock {...base} />);
    expect(screen.getByLabelText("Name")).toBeRequired();
    expect(screen.getByLabelText("Email")).toBeRequired();
    expect(screen.getByLabelText(/Instagram handle/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join the list" })).toBeInTheDocument();
    expect(screen.getByText("No spam.")).toBeInTheDocument();
    rerender(<OptInFormBlock {...base} instagramField="none" />);
    expect(screen.queryByLabelText(/Instagram handle/)).toBeNull();
  });

  it("sends nothing from the editor or the preview", async () => {
    visit("/admin/pages/spring");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<OptInFormBlock {...base} />);
    expect(await screen.findByText(/nothing is sent from here/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join the list" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("at the page's address", () => {
    async function pageSentFrom(path: string) {
      visit(path);
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup();
      render(<OptInFormBlock {...base} />);
      await waitFor(() => expect(screen.getByRole("button", { name: "Join the list" })).toBeEnabled());
      await user.type(screen.getByLabelText("Name"), "Ada Example");
      await user.type(screen.getByLabelText("Email"), "ada@example.test");
      await user.click(screen.getByRole("button", { name: "Join the list" }));
      await screen.findByRole("status");
      return JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).page;
    }

    it("reads the page from the bare address, with or without a trailing slash, and from /p/<slug>", async () => {
      expect(await pageSentFrom("/spring")).toBe("spring");
      cleanup();
      expect(await pageSentFrom("/spring/")).toBe("spring");
      cleanup();
      expect(await pageSentFrom("/p/spring")).toBe("spring");
    });

    it("is the page `home` at /", async () => {
      expect(await pageSentFrom("/")).toBe("home");
    });

    it("sends nothing from an address that is a real path, not a page", async () => {
      visit("/dashboard");
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      render(<OptInFormBlock {...base} />);
      expect(await screen.findByText(/nothing is sent from here/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Join the list" })).toBeDisabled();
    });
  });

  describe("on the public page", () => {
    beforeEach(() => visit("/p/spring"));

    async function fill() {
      const user = userEvent.setup();
      await waitFor(() => expect(screen.getByRole("button", { name: "Join the list" })).toBeEnabled());
      await user.type(screen.getByLabelText("Name"), "Ada Example");
      await user.type(screen.getByLabelText("Email"), "ada@example.test");
      await user.type(screen.getByLabelText(/Instagram handle/), "@ada.example");
      await user.click(screen.getByRole("button", { name: "Join the list" }));
    }

    it("posts to our relay, not to Kajabi, with the page address and the form, then shows the success message", async () => {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      render(<OptInFormBlock {...base} />);
      await fill();
      expect(await screen.findByRole("status")).toHaveTextContent("You're in!");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("/api/landing/opt-in");
      expect(JSON.parse(init.body as string)).toEqual({ page: "spring", formId: "form-123", name: "Ada Example", email: "ada@example.test", instagram: "@ada.example", website: "" });
    });

    it("shows the relay's calm message and lets the visitor try again when it fails", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "That email address doesn't look right." }), { status: 400 })));
      render(<OptInFormBlock {...base} />);
      await fill();
      expect(await screen.findByRole("alert")).toHaveTextContent("That email address doesn't look right.");
      expect(screen.getByRole("button", { name: "Join the list" })).toBeEnabled();
    });

    it("says so when the network fails", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
      render(<OptInFormBlock {...base} />);
      await fill();
      expect(await screen.findByRole("alert")).toHaveTextContent(/check your connection/);
    });

    it("goes to the thank-you page when one is set", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
      const assign = vi.fn();
      vi.stubGlobal("location", { ...window.location, pathname: "/p/spring", assign });
      render(<OptInFormBlock {...base} href="/p/thanks" />);
      await fill();
      await waitFor(() => expect(assign).toHaveBeenCalledWith("/p/thanks"));
    });
  });
});

describe("opt-in form checks", () => {
  it("stops a publish when no Kajabi form is chosen", () => {
    const issues = checkLandingPage({ content: [{ type: "OptInForm", props: { id: "o", kajabiFormId: "", buttonLabel: "Go" } }], root: {} });
    expect(issues.some((i) => i.severity === "error" && i.block === "Sign-up form")).toBe(true);
    const ok = checkLandingPage({ content: [{ type: "OptInForm", props: { id: "o", kajabiFormId: "form-123", buttonLabel: "Go" } }], root: {} });
    expect(ok.some((i) => i.block === "Sign-up form")).toBe(false);
  });
});
