// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OptInFormBlock } from "@/components/landing/blocks";
import { checkLandingPage } from "@/lib/landing/a11y";
import { SIGNED_UP_KEY } from "@/lib/landing/exit-popup";

const base = { kajabiFormId: "form-123", instagramField: "custom_1" as const, buttonLabel: "Join the list", reassurance: "No spam.", successMessage: "You're in!", href: "", look: "solid" as const, color: "plum" as const, shape: "pill" as const };

function visit(path: string) {
  window.history.pushState({}, "", path);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("data-consent-required");
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

    it("remembers the sign-up site-wide, so no exit popup on any page asks again (also when it goes on to a thank-you page)", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
      const first = render(<OptInFormBlock {...base} />);
      await fill();
      await screen.findByRole("status");
      expect(JSON.parse(localStorage.getItem(SIGNED_UP_KEY)!)).toEqual({ at: expect.any(Number), submitted: true });
      first.unmount();
      localStorage.clear();
      vi.stubGlobal("location", { ...window.location, pathname: "/p/spring", assign: vi.fn() });
      render(<OptInFormBlock {...base} href="/p/thanks" />);
      await fill();
      await waitFor(() => expect(localStorage.getItem(SIGNED_UP_KEY)).not.toBeNull());
    });

    it("keeps nothing where the consent banner asks and was not accepted, and nothing when the sign-up fails", async () => {
      document.documentElement.setAttribute("data-consent-required", "");
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
      const first = render(<OptInFormBlock {...base} />);
      await fill();
      await screen.findByRole("status");
      expect(localStorage.length).toBe(0);
      first.unmount();
      document.documentElement.removeAttribute("data-consent-required");
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "no" }), { status: 400 })));
      render(<OptInFormBlock {...base} />);
      await fill();
      await screen.findByRole("alert");
      expect(localStorage.length).toBe(0);
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
