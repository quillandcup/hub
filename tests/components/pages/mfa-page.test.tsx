// @vitest-environment jsdom
/** /mfa: the gate page for staff (GATES.staffMfa): the code screen, the set-up screen, or on to where they were headed. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import {
  ADMIN_USER,
  expectRedirect,
  renderServerPage,
  resetServerPageMocks,
  signInAs,
  useFakeSupabase,
} from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
const status = vi.hoisted(() => ({ value: { aal2: false, hasFactor: true } }));
vi.mock("@/lib/staff-mfa.server", () => ({ readMfaStatus: async () => status.value }));
vi.mock("@/components/mfa/MfaChallengeForm", () => ({ default: ({ next }: { next: string }) => <div data-testid="challenge" data-next={next} /> }));
vi.mock("@/components/mfa/MfaPanel", () => ({ default: ({ afterEnrol }: { afterEnrol?: string }) => <div data-testid="enrol" data-after={afterEnrol} /> }));

import MfaPage from "@/app/mfa/page";
import { GATES } from "@/lib/gates";

const props = (next?: string) => ({ searchParams: Promise.resolve(next ? { next } : {}) });

beforeEach(() => {
  resetServerPageMocks();
  useFakeSupabase();
  status.value = { aal2: false, hasFactor: true };
});

describe("/mfa", () => {
  it("sends a signed-out visitor to /login", async () => {
    signInAs(null);
    await expectRedirect(MfaPage, props(), "/login");
  });

  it("asks an aal1 staff member with a factor for their code, carrying where they were going", async () => {
    signInAs(ADMIN_USER, null);
    await renderServerPage(MfaPage, props("/admin/members"));
    expect(screen.getByRole("heading", { name: "Enter your sign-in code" })).toBeInTheDocument();
    expect(screen.getByTestId("challenge")).toHaveAttribute("data-next", "/admin/members");
    expect(screen.getByRole("link", { name: /Not now/ })).toHaveAttribute("href", GATES.staffMfa.declineTo);
  });

  it("shows the set-up screen when the account has no factor", async () => {
    status.value = { aal2: false, hasFactor: false };
    signInAs(ADMIN_USER, null);
    await renderServerPage(MfaPage, props("/admin/care"));
    expect(screen.getByRole("heading", { name: "Set up two-step sign-in" })).toBeInTheDocument();
    expect(screen.getByTestId("enrol")).toHaveAttribute("data-after", "/admin/care");
  });

  it("falls back to /admin when the destination isn't a safe same-origin path", async () => {
    signInAs(ADMIN_USER, null);
    await renderServerPage(MfaPage, props("https://evil.example.com/"));
    expect(screen.getByTestId("challenge")).toHaveAttribute("data-next", "/admin");
  });

  it("sends a session that already passed the second step on to its destination", async () => {
    status.value = { aal2: true, hasFactor: true };
    signInAs(ADMIN_USER, null);
    await expectRedirect(MfaPage, props("/admin/members"), "/admin/members");
  });
});
