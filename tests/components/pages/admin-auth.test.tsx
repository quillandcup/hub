// @vitest-environment jsdom
/**
 * The secure staff checks behind src/proxy.ts's optimistic /admin pre-filter (src/lib/admin-auth.ts):
 * requirePermission() in the admin layout and every admin page, requireActionPermission() in every
 * server action. Signed-in people without the permission end at /no-access. Which file calls which guard is
 * checked for every file in tests/lib/permission-guards.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import {
  ADMIN_USER,
  MEMBER_USER,
  expectRedirect,
  redirect,
  renderServerPage,
  resetServerPageMocks,
  signInAs,
  useFakeSupabase,
  type FakeQuery,
} from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const preview = vi.hoisted(() => ({ role: null as string | null }));
vi.mock("@/lib/staff-preview.server", () => ({ getStaffPreviewRole: async () => preview.role }));
// The second sign-in step (src/lib/staff-mfa.ts); its own states are tested in tests/lib/staff-mfa.test.ts.
const mfa = vi.hoisted(() => ({ state: "ok" as "ok" | "challenge" | "enrol" | "suggest" }));
vi.mock("@/lib/staff-mfa.server", () => ({ getStaffMfaState: async () => mfa.state }));
vi.mock("@/lib/gates.server", async () => {
  const { redirect: mockedRedirect } = await import("@/tests/helpers/server-page");
  const { gateHref } = await import("@/lib/gates");
  return { redirectToGate: async (gate: Parameters<typeof gateHref>[0]) => mockedRedirect(gateHref(gate, "/admin/members")) };
});

vi.mock("@/lib/features.server", () => ({
  getUserFeaturePreviews: vi.fn(async () => []),
}));
vi.mock("@/components/LiveRoomIndicator", () => ({ default: () => null }));
vi.mock("@/components/WithInAppNotifications", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/app/(admin)/admin/AdminNavigation", () => ({ default: () => <nav data-testid="admin-nav" /> }));
vi.mock("@/components/UserMenu", () => ({
  default: ({ userEmail }: { userEmail: string }) => <div data-testid="user-menu">{userEmail}</div>,
}));
vi.mock("@/components/FeedbackWidget", () => ({ default: () => null }));
vi.mock("@/components/SignOutButton", () => ({ default: () => <button>Sign Out</button> }));

import { MFA_REQUIRED_ERROR, requireActionPermission, requirePermission } from "@/lib/admin-auth";
import AdminLayout from "@/app/(admin)/layout";
import AdminWheelOfWonderPage from "@/app/(admin)/admin/wheel-of-wonder/page";
import StreaksPage from "@/app/(member)/streaks/page";
import NoAccessPage from "@/app/no-access/page";
import { dismissGroup, undismissGroup } from "@/app/(admin)/admin/hygiene/merge-fix/actions";
import { SUPPORT_EMAIL } from "@/lib/config"

const CM_USER = { id: "user-community-manager", email: "cm@example.test" };
const CS_USER = { id: "user-conversion-specialist", email: "cs@example.test" };
const ASSISTANT_USER = { id: "user-assistant", email: "assistant@example.test" };
const ROLES: Record<string, string> = {
  [ADMIN_USER.id]: "admin",
  [MEMBER_USER.id]: "member",
  [CM_USER.id]: "community_manager",
  [CS_USER.id]: "conversion_specialist",
  [ASSISTANT_USER.id]: "assistant",
};
const userProfiles = (q: FakeQuery) => {
  const id = q.calls.find((c) => c.method === "eq" && c.args[0] === "id")?.args[1] as string;
  return { data: ROLES[id] ? [{ role: ROLES[id] }] : [] };
};

const SUDO_IDENTITY = { memberId: "member-fern", memberName: "Fern", memberEmail: "f@x.test", isSudo: true };
const layoutProps = { children: <p>admin page body</p> };
// expectRedirect() takes a page-shaped function; wrap the helper as one.
const guardedPage = async () => {
  await requirePermission("system.users.manage");
  return null;
};
const pageNeeding = (permission: Parameters<typeof requirePermission>[0]) => async () => {
  await requirePermission(permission);
  return null;
};

beforeEach(() => {
  preview.role = null;
  mfa.state = "ok";
  resetServerPageMocks();
  useFakeSupabase({ user_profiles: userProfiles });
});

describe("requirePermission", () => {
  it("returns the signed-in admin with their role", async () => {
    signInAs(ADMIN_USER, null);
    await expect(requirePermission("system.users.manage")).resolves.toEqual({ ...ADMIN_USER, role: "admin", roles: ["admin"], realRole: "admin", realRoles: ["admin"] });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("returns the admin while they're in sudo mode as a member", async () => {
    signInAs(ADMIN_USER, SUDO_IDENTITY);
    await expect(requirePermission("system.users.manage")).resolves.toMatchObject({ role: "admin" });
  });

  it("lets the assistant through everything the admin may open", async () => {
    signInAs(ASSISTANT_USER, null);
    await expect(requirePermission("system.users.manage")).resolves.toEqual({ ...ASSISTANT_USER, role: "assistant", roles: ["assistant"], realRole: "assistant", realRoles: ["assistant"] });
  });

  it("returns a community manager only for what the role holds", async () => {
    signInAs(CM_USER, null);
    await expect(requirePermission("members.read")).resolves.toEqual({ ...CM_USER, role: "community_manager", roles: ["community_manager"], realRole: "community_manager", realRoles: ["community_manager"] });
    await expectRedirect(guardedPage, undefined, "/no-access");
  });

  it("returns a conversion specialist for the landing pages and outreach, and keeps them out of the members area and the changelog", async () => {
    signInAs(CS_USER, null);
    await expect(requirePermission("pages.edit")).resolves.toEqual({ ...CS_USER, role: "conversion_specialist", roles: ["conversion_specialist"], realRole: "conversion_specialist", realRoles: ["conversion_specialist"] });
    await expect(requirePermission("outreach.manage")).resolves.toMatchObject({ role: "conversion_specialist" });
    for (const permission of ["members.read", "changelog.read", "member.sudo", "system.users.manage"] as const) {
      await expectRedirect(pageNeeding(permission), undefined, "/no-access");
    }
  });

  it("sends a signed-out visitor to /login", async () => {
    signInAs(null);
    await expectRedirect(guardedPage, undefined, "/login");
  });

  it("sends a member to /no-access", async () => {
    signInAs(MEMBER_USER, null);
    await expectRedirect(guardedPage, undefined, "/no-access");
  });

  it("sends a user with no profile row to /no-access", async () => {
    signInAs({ id: "user-no-profile", email: "nobody@example.test" }, null);
    await expectRedirect(guardedPage, undefined, "/no-access");
  });

  it("sends a user whose profile can't be read to /no-access", async () => {
    useFakeSupabase({ user_profiles: () => ({ error: { message: "database is down" } }) });
    signInAs(ADMIN_USER, null);
    await expectRedirect(guardedPage, undefined, "/no-access");
  });
});

describe("previewing a role", () => {
  it("treats an admin previewing the community manager as that role, sending them home from a page the role may not open", async () => {
    preview.role = "community_manager";
    signInAs(ADMIN_USER, null);
    await expect(requirePermission("members.read")).resolves.toEqual({ ...ADMIN_USER, role: "community_manager", roles: ["community_manager"], realRole: "admin", realRoles: ["admin"] });
    await expectRedirect(guardedPage, undefined, "/admin/at-risk");
  });

  it("treats an admin previewing the conversion specialist as that role", async () => {
    preview.role = "conversion_specialist";
    signInAs(ADMIN_USER, null);
    await expect(requirePermission("pages.edit")).resolves.toEqual({ ...ADMIN_USER, role: "conversion_specialist", roles: ["conversion_specialist"], realRole: "admin", realRoles: ["admin"] });
    await expectRedirect(pageNeeding("members.read"), undefined, "/admin/pages");
    await expectRedirect(pageNeeding("changelog.read"), undefined, "/admin/pages");
    await expect(requireActionPermission("members.write")).resolves.toEqual({ ok: false, error: "Not authorized" });
    await expect(requireActionPermission("pages.publish")).resolves.toMatchObject({ ok: true, role: "conversion_specialist", realRole: "admin" });
  });

  it("leaves a real community manager or specialist as themselves even with the cookie set", async () => {
    preview.role = "conversion_specialist";
    signInAs(CM_USER, null);
    await expect(requirePermission("members.read")).resolves.toMatchObject({ role: "community_manager", realRole: "community_manager" });
    signInAs(CS_USER, null);
    await expectRedirect(pageNeeding("members.read"), undefined, "/no-access");
    await expect(requirePermission("pages.edit")).resolves.toMatchObject({ role: "conversion_specialist", realRole: "conversion_specialist" });
  });

  it("refuses an admin's actions that the previewed role may not do", async () => {
    preview.role = "community_manager";
    signInAs(ADMIN_USER, null);
    await expect(requireActionPermission("system.users.manage")).resolves.toEqual({ ok: false, error: "Not authorized" });
  });
});

describe("admin layout", () => {
  it("shows the preview banner to an admin previewing the role, and not otherwise", async () => {
    preview.role = "community_manager";
    signInAs(ADMIN_USER, null);
    await renderServerPage(AdminLayout, layoutProps);
    expect(screen.getByText(/Previewing as/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exit preview" })).toBeInTheDocument();
  });

  it("shows no preview banner to an admin who isn't previewing", async () => {
    signInAs(ADMIN_USER, null);
    await renderServerPage(AdminLayout, layoutProps);
    expect(screen.queryByText(/Previewing as/)).not.toBeInTheDocument();
  });

  it("renders the shell for a community manager and a conversion specialist", async () => {
    for (const user of [CM_USER, CS_USER]) {
      signInAs(user, null);
      await renderServerPage(AdminLayout, layoutProps);
      expect(screen.getByTestId("admin-nav")).toBeInTheDocument();
      expect(screen.getByText("admin page body")).toBeInTheDocument();
      cleanup();
    }
  });

  it("names the previewed role in the banner", async () => {
    preview.role = "conversion_specialist";
    signInAs(ADMIN_USER, null);
    await renderServerPage(AdminLayout, layoutProps);
    expect(screen.getByText(/Previewing as/)).toHaveTextContent("Conversion Specialist");
  });

  it("renders the admin shell and page for an admin", async () => {
    signInAs(ADMIN_USER, null);
    await renderServerPage(AdminLayout, layoutProps);
    expect(screen.getByTestId("admin-nav")).toBeInTheDocument();
    expect(screen.getByTestId("user-menu")).toHaveTextContent(ADMIN_USER.email!);
    expect(screen.getByText("admin page body")).toBeInTheDocument();
  });

  it("makes the shell the positioned ancestor, so an sr-only element can't stretch the page past the window", async () => {
    signInAs(ADMIN_USER, null);
    await renderServerPage(AdminLayout, layoutProps);
    const shell = screen.getByText("admin page body").closest("div.h-dvh");
    expect(shell).toHaveClass("relative", "overflow-hidden");
  });

  it("redirects a member to /no-access instead of rendering the admin area", async () => {
    signInAs(MEMBER_USER, null);
    await expectRedirect(AdminLayout, layoutProps, "/no-access");
  });

  it("redirects a signed-out visitor to /login", async () => {
    signInAs(null);
    await expectRedirect(AdminLayout, layoutProps, "/login");
  });
});

describe("/no-access", () => {
  it("renders the staff-only message, dashboard link, support contact and sign-out without redirecting", async () => {
    signInAs(MEMBER_USER, null);
    await renderServerPage(NoAccessPage, {});
    expect(screen.getByRole("heading", { name: /for Quill & Cup staff/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to your dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: SUPPORT_EMAIL })).toHaveAttribute(
      "href",
      `mailto:${SUPPORT_EMAIL}`
    );
    expect(screen.getByRole("button", { name: "Sign Out" })).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("ends the chain for a non-admin with no member record: member page → /admin → /no-access", async () => {
    // Every member page sends a user with no effective member identity to /admin. The admin side
    // must send a non-admin somewhere that doesn't redirect again, or the two bounce forever.
    signInAs(MEMBER_USER, null);
    const routes: Record<string, () => Promise<unknown>> = {
      "/dashboard": () => StreaksPage(),
      "/admin": () => AdminLayout(layoutProps),
      "/admin/wheel-of-wonder": () => AdminWheelOfWonderPage(),
      "/no-access": async () => NoAccessPage(),
    };
    for (const start of ["/dashboard", "/admin/wheel-of-wonder"]) {
      const visited: string[] = [];
      let current: string | null = start;
      while (current) {
        expect(visited, `redirect cycle: ${[...visited, current].join(" → ")}`).not.toContain(current);
        visited.push(current);
        redirect.mockClear();
        try {
          await routes[current]();
          current = null; // rendered
        } catch (e) {
          const target = (e as { digest?: string }).digest?.split(";")[2];
          if (!target) throw e;
          current = target;
        }
      }
      expect(visited.at(-1)).toBe("/no-access");
    }
  });
});

describe("requireActionPermission", () => {
  it("returns the admin with their role and a client", async () => {
    signInAs(ADMIN_USER, null);
    await expect(requireActionPermission("system.users.manage")).resolves.toMatchObject({ ok: true, user: ADMIN_USER, role: "admin", realRole: "admin" });
  });

  it("allows an admin in sudo mode", async () => {
    signInAs(ADMIN_USER, SUDO_IDENTITY);
    await expect(requireActionPermission("system.users.manage")).resolves.toMatchObject({ ok: true, role: "admin" });
  });

  it("allows the assistant what the admin may do", async () => {
    signInAs(ASSISTANT_USER, null);
    await expect(requireActionPermission("system.users.manage")).resolves.toMatchObject({ ok: true, role: "assistant" });
  });

  it("returns a community manager for Hedgie Care, which the admin-only actions refuse", async () => {
    signInAs(CM_USER, null);
    await expect(requireActionPermission("care.write")).resolves.toMatchObject({ ok: true, user: CM_USER, role: "community_manager", realRole: "community_manager" });
    await expect(requireActionPermission("system.users.manage")).resolves.toEqual({ ok: false, error: "Not authorized" });
  });

  it("returns a conversion specialist for landing pages and outreach, and refuses the members area, the changelog and exports", async () => {
    signInAs(CS_USER, null);
    for (const permission of ["pages.edit", "pages.publish", "outreach.manage", "email.send"] as const) {
      await expect(requireActionPermission(permission), permission).resolves.toMatchObject({ ok: true, role: "conversion_specialist" });
    }
    for (const permission of ["pages.delete", "members.write", "member.sudo", "member.merge", "member.notes_write", "changelog.edit", "data.export", "system.users.manage"] as const) {
      await expect(requireActionPermission(permission), permission).resolves.toEqual({ ok: false, error: "Not authorized" });
    }
  });

  it("rejects a signed-out caller, and a member or a user with no profile row", async () => {
    signInAs(null);
    await expect(requireActionPermission("care.write")).resolves.toEqual({ ok: false, error: "Not authenticated" });
    signInAs(MEMBER_USER, null);
    await expect(requireActionPermission("care.write")).resolves.toEqual({ ok: false, error: "Not authorized" });
    signInAs({ id: "user-no-profile" }, null);
    await expect(requireActionPermission("care.write")).resolves.toEqual({ ok: false, error: "Not authorized" });
  });

  it("rejects when the profile can't be read", async () => {
    useFakeSupabase({ user_profiles: () => ({ error: { message: "database is down" } }) });
    signInAs(CM_USER, null);
    await expect(requireActionPermission("care.write")).resolves.toEqual({ ok: false, error: "Not authorized" });
  });
});

describe("the second sign-in step (src/lib/staff-mfa.ts)", () => {
  const MFA_GATE = "/mfa?staff=required&next=%2Fadmin%2Fmembers";

  it.each(["ok", "suggest"] as const)("lets an admin through both guards when the state is %s", async (state) => {
    mfa.state = state;
    signInAs(ADMIN_USER, null);
    await expect(requirePermission("system.users.manage")).resolves.toMatchObject({ role: "admin" });
    await expect(requireActionPermission("system.users.manage")).resolves.toMatchObject({ ok: true });
  });

  it.each(["challenge", "enrol"] as const)("sends staff on a page to /mfa with their destination when the state is %s", async (state) => {
    mfa.state = state;
    for (const user of [ADMIN_USER, CM_USER, CS_USER]) {
      signInAs(user, null);
      await expectRedirect(pageNeeding("staff.access"), undefined, MFA_GATE);
    }
  });

  it.each(["challenge", "enrol"] as const)("refuses every staff role's server actions when the state is %s", async (state) => {
    mfa.state = state;
    signInAs(ADMIN_USER, null);
    await expect(requireActionPermission("system.users.manage")).resolves.toEqual({ ok: false, error: MFA_REQUIRED_ERROR });
    signInAs(CM_USER, null);
    await expect(requireActionPermission("care.write")).resolves.toEqual({ ok: false, error: MFA_REQUIRED_ERROR });
    signInAs(CS_USER, null);
    await expect(requireActionPermission("pages.edit")).resolves.toEqual({ ok: false, error: MFA_REQUIRED_ERROR });
  });

  it("keeps sending someone without the permission to /no-access, not to /mfa", async () => {
    mfa.state = "enrol";
    signInAs(MEMBER_USER, null);
    await expectRedirect(guardedPage, undefined, "/no-access");
    signInAs(CS_USER, null);
    await expectRedirect(pageNeeding("members.read"), undefined, "/no-access");
    await expect(requireActionPermission("system.users.manage")).resolves.toEqual({ ok: false, error: "Not authorized" });
  });

  it("keeps sudo working: an admin at the second level in sudo mode still passes", async () => {
    signInAs(ADMIN_USER, SUDO_IDENTITY);
    await expect(requirePermission("system.users.manage")).resolves.toMatchObject({ role: "admin" });
    await expect(requireActionPermission("system.users.manage")).resolves.toMatchObject({ ok: true });
  });

  it("shows staff without a second step a banner in the admin layout, and nobody else", async () => {
    mfa.state = "suggest";
    signInAs(ADMIN_USER, null);
    await renderServerPage(AdminLayout, layoutProps);
    expect(screen.getByRole("link", { name: "Set it up" })).toHaveAttribute("href", "/settings#two-step-sign-in");
  });

  it("shows no banner once the admin has the second step", async () => {
    signInAs(ADMIN_USER, null);
    await renderServerPage(AdminLayout, layoutProps);
    expect(screen.queryByRole("link", { name: "Set it up" })).toBeNull();
  });
});

describe("merge-fix dismiss actions", () => {
  it.each([
    ["dismissGroup", dismissGroup],
    ["undismissGroup", undismissGroup],
  ] as const)("%s refuses a member called directly, without touching the table", async (_name, action) => {
    signInAs(MEMBER_USER, null);
    const supabase = useFakeSupabase({ user_profiles: userProfiles });
    await expect(action("m1|m2")).resolves.toEqual({ error: "Not authorized" });
    expect(supabase.queries.map((q) => q.table)).not.toContain("dismissed_duplicate_groups");
  });

  it("dismissGroup writes for an admin", async () => {
    signInAs(ADMIN_USER, null);
    const supabase = useFakeSupabase({ user_profiles: userProfiles });
    await expect(dismissGroup("m1|m2")).resolves.toEqual({ success: true });
    const write = supabase.queries.find((q) => q.table === "dismissed_duplicate_groups");
    expect(write?.calls[0]).toEqual({ method: "insert", args: [{ group_key: "m1|m2" }] });
  });
});
