// @vitest-environment jsdom
/**
 * The secure admin checks behind src/proxy.ts's optimistic /admin pre-filter (src/lib/admin-auth.ts):
 * requireAdminPage() in the admin layout and every admin page, requireAdminAction() in every
 * admin server action. Signed-in non-admins end at /no-access.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
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

import { MFA_REQUIRED_ERROR, requireAdminAction, requireAdminPage, requireStaffAction, requireStaffPage } from "@/lib/admin-auth";
import { isCommunityManagerPath } from "@/lib/staff-access";
import AdminLayout from "@/app/(admin)/layout";
import AdminWheelOfWonderPage from "@/app/(admin)/admin/wheel-of-wonder/page";
import StreaksPage from "@/app/(member)/streaks/page";
import NoAccessPage from "@/app/no-access/page";
import { dismissGroup, undismissGroup } from "@/app/(admin)/admin/hygiene/merge-fix/actions";
import { SUPPORT_EMAIL } from "@/lib/config"

const CM_USER = { id: "user-community-manager", email: "cm@example.test" };
const ROLES: Record<string, string> = { [ADMIN_USER.id]: "admin", [MEMBER_USER.id]: "member", [CM_USER.id]: "community_manager" };
const userProfiles = (q: FakeQuery) => {
  const id = q.calls.find((c) => c.method === "eq" && c.args[0] === "id")?.args[1] as string;
  return { data: ROLES[id] ? [{ role: ROLES[id] }] : [] };
};

const SUDO_IDENTITY = { memberId: "member-fern", memberName: "Fern", memberEmail: "f@x.test", isSudo: true };
const layoutProps = { children: <p>admin page body</p> };
// expectRedirect() takes a page-shaped function; wrap the helper as one.
const guardedPage = async () => {
  await requireAdminPage();
  return null;
};

beforeEach(() => {
  preview.role = null;
  mfa.state = "ok";
  resetServerPageMocks();
  useFakeSupabase({ user_profiles: userProfiles });
});

describe("requireAdminPage", () => {
  it("returns the signed-in admin", async () => {
    signInAs(ADMIN_USER, null);
    await expect(requireAdminPage()).resolves.toEqual(ADMIN_USER);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("returns the admin while they're in sudo mode as a member", async () => {
    signInAs(ADMIN_USER, SUDO_IDENTITY);
    await expect(requireAdminPage()).resolves.toEqual(ADMIN_USER);
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
});

describe("requireStaffPage", () => {
  it("returns an admin with their role", async () => {
    signInAs(ADMIN_USER, null);
    await expect(requireStaffPage()).resolves.toEqual({ ...ADMIN_USER, role: "admin", realRole: "admin" });
  });

  it("returns a community manager with their role", async () => {
    signInAs(CM_USER, null);
    await expect(requireStaffPage()).resolves.toEqual({ ...CM_USER, role: "community_manager", realRole: "community_manager" });
  });

  it("treats an admin previewing the role as a community manager, and refuses admin pages and actions", async () => {
    preview.role = "community_manager";
    signInAs(ADMIN_USER, null);
    await expect(requireStaffPage()).resolves.toEqual({ ...ADMIN_USER, role: "community_manager", realRole: "admin" });
    await expectRedirect(guardedPage, undefined, "/admin/at-risk");
    await expect(requireAdminAction()).resolves.toEqual({ ok: false, error: "Not authorized" });
  });

  it("leaves a real community manager as themselves even with the cookie set", async () => {
    preview.role = "community_manager";
    signInAs(CM_USER, null);
    await expect(requireStaffPage()).resolves.toMatchObject({ role: "community_manager", realRole: "community_manager" });
  });

  it("keeps a community manager out of requireAdminPage and requireAdminAction", async () => {
    signInAs(CM_USER, null);
    await expectRedirect(guardedPage, undefined, "/no-access");
    await expect(requireAdminAction()).resolves.toEqual({ ok: false, error: "Not authorized" });
  });

  it("sends a signed-out visitor to /login, and a member or a user with no profile to /no-access", async () => {
    const staffPage = async () => {
      await requireStaffPage();
      return null;
    };
    signInAs(null);
    await expectRedirect(staffPage, undefined, "/login");
    signInAs(MEMBER_USER, null);
    await expectRedirect(staffPage, undefined, "/no-access");
    signInAs({ id: "user-no-profile", email: "nobody@example.test" }, null);
    await expectRedirect(staffPage, undefined, "/no-access");
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

  it("renders the shell for a community manager, without the admin-only menu", async () => {
    signInAs(CM_USER, null);
    await renderServerPage(AdminLayout, layoutProps);
    expect(screen.getByTestId("admin-nav")).toBeInTheDocument();
    expect(screen.getByText("admin page body")).toBeInTheDocument();
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

describe("requireAdminAction", () => {
  it("returns the admin and a client", async () => {
    signInAs(ADMIN_USER, null);
    const auth = await requireAdminAction();
    expect(auth).toMatchObject({ ok: true, user: ADMIN_USER });
  });

  it("allows an admin in sudo mode", async () => {
    signInAs(ADMIN_USER, SUDO_IDENTITY);
    await expect(requireAdminAction()).resolves.toMatchObject({ ok: true });
  });

  it("rejects a signed-out caller", async () => {
    signInAs(null);
    await expect(requireAdminAction()).resolves.toEqual({ ok: false, error: "Not authenticated" });
  });

  it("rejects a member and a user with no profile row", async () => {
    signInAs(MEMBER_USER, null);
    await expect(requireAdminAction()).resolves.toEqual({ ok: false, error: "Not authorized" });
    signInAs({ id: "user-no-profile" }, null);
    await expect(requireAdminAction()).resolves.toEqual({ ok: false, error: "Not authorized" });
  });
});

describe("requireStaffAction", () => {
  it("returns an admin with their role and the client", async () => {
    signInAs(ADMIN_USER, null);
    await expect(requireStaffAction()).resolves.toMatchObject({ ok: true, user: ADMIN_USER, role: "admin", realRole: "admin" });
  });

  it("returns a community manager, which requireAdminAction refuses", async () => {
    signInAs(CM_USER, null);
    await expect(requireStaffAction()).resolves.toMatchObject({ ok: true, user: CM_USER, role: "community_manager", realRole: "community_manager" });
    await expect(requireAdminAction()).resolves.toEqual({ ok: false, error: "Not authorized" });
  });

  it("allows an admin in sudo mode", async () => {
    signInAs(ADMIN_USER, SUDO_IDENTITY);
    await expect(requireStaffAction()).resolves.toMatchObject({ ok: true, role: "admin" });
  });

  it("treats an admin previewing the community manager as that role, so what the role may not do is refused", async () => {
    preview.role = "community_manager";
    signInAs(ADMIN_USER, null);
    await expect(requireStaffAction()).resolves.toMatchObject({ ok: true, role: "community_manager", realRole: "admin" });
  });

  it("leaves a real community manager as themselves even with the preview cookie set", async () => {
    preview.role = "community_manager";
    signInAs(CM_USER, null);
    await expect(requireStaffAction()).resolves.toMatchObject({ ok: true, role: "community_manager", realRole: "community_manager" });
  });

  it("rejects a signed-out caller, and a member or a user with no profile row", async () => {
    signInAs(null);
    await expect(requireStaffAction()).resolves.toEqual({ ok: false, error: "Not authenticated" });
    signInAs(MEMBER_USER, null);
    await expect(requireStaffAction()).resolves.toEqual({ ok: false, error: "Not authorized" });
    signInAs({ id: "user-no-profile" }, null);
    await expect(requireStaffAction()).resolves.toEqual({ ok: false, error: "Not authorized" });
  });

  it("rejects when the profile can't be read", async () => {
    useFakeSupabase({ user_profiles: () => ({ error: { message: "database is down" } }) });
    signInAs(CM_USER, null);
    await expect(requireStaffAction()).resolves.toEqual({ ok: false, error: "Not authorized" });
  });
});

describe("the second sign-in step (src/lib/staff-mfa.ts)", () => {
  const MFA_GATE = "/mfa?staff=required&next=%2Fadmin%2Fmembers";
  const staffPage = async () => {
    await requireStaffPage();
    return null;
  };

  it.each(["ok", "suggest"] as const)("lets an admin through all three guards when the state is %s", async (state) => {
    mfa.state = state;
    signInAs(ADMIN_USER, null);
    await expect(requireAdminPage()).resolves.toEqual(ADMIN_USER);
    await expect(requireStaffPage()).resolves.toMatchObject({ role: "admin" });
    await expect(requireAdminAction()).resolves.toMatchObject({ ok: true });
    await expect(requireStaffAction()).resolves.toMatchObject({ ok: true });
  });

  it.each(["challenge", "enrol"] as const)("sends an admin on a page to /mfa with their destination when the state is %s", async (state) => {
    mfa.state = state;
    signInAs(ADMIN_USER, null);
    await expectRedirect(guardedPage, undefined, MFA_GATE);
    await expectRedirect(staffPage, undefined, MFA_GATE);
  });

  it.each(["challenge", "enrol"] as const)("refuses an admin's and a community manager's server actions when the state is %s", async (state) => {
    mfa.state = state;
    signInAs(ADMIN_USER, null);
    await expect(requireAdminAction()).resolves.toEqual({ ok: false, error: MFA_REQUIRED_ERROR });
    await expect(requireStaffAction()).resolves.toEqual({ ok: false, error: MFA_REQUIRED_ERROR });
    signInAs(CM_USER, null);
    await expect(requireStaffAction()).resolves.toEqual({ ok: false, error: MFA_REQUIRED_ERROR });
    await expectRedirect(staffPage, undefined, MFA_GATE);
  });

  it("keeps sending a non-admin to /no-access, not to /mfa", async () => {
    mfa.state = "enrol";
    signInAs(MEMBER_USER, null);
    await expectRedirect(guardedPage, undefined, "/no-access");
    await expectRedirect(staffPage, undefined, "/no-access");
    await expect(requireAdminAction()).resolves.toEqual({ ok: false, error: "Not authorized" });
  });

  it("keeps sudo working: an admin at the second level in sudo mode still passes", async () => {
    signInAs(ADMIN_USER, SUDO_IDENTITY);
    await expect(requireAdminPage()).resolves.toEqual(ADMIN_USER);
    await expect(requireAdminAction()).resolves.toMatchObject({ ok: true });
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

// Conformance: these catch a new admin page / admin action added without its check. (Source
// scans, unlike the behavioural tests above, because the point is "every file", not one flow.)
const repoRoot = path.resolve(__dirname, "../../..");
const adminRoot = path.join(repoRoot, "src/app/(admin)");
const adminFiles = (fs.readdirSync(adminRoot, { recursive: true }) as string[]).map((f) =>
  path.join("src/app/(admin)", f)
);
const read = (file: string) => fs.readFileSync(path.join(repoRoot, file), "utf8");

// The route a page file serves: "src/app/(admin)/admin/members/[id]/slack/page.tsx" → "/admin/members/x/slack".
const routeOf = (file: string) =>
  file.replace("src/app/(admin)", "").replace(/\/page\.tsx$/, "").replace(/\[[^\]]+\]/g, "x") || "/";

describe("every admin page calls requireAdminPage(), or requireStaffPage() when a community manager may open it", () => {
  // Layouts don't re-run on client navigation and don't stop a page segment from rendering.
  const pages = adminFiles.filter((f) => f.endsWith("page.tsx"));

  it("finds the admin pages", () => {
    expect(pages.length).toBeGreaterThan(40);
  });

  it.each(pages)("%s", (file) => {
    // Admin-only unless src/lib/staff-access.ts lists the route: a page can't open to a community manager
    // without the allowlist (proxy and sidebar) agreeing, nor be listed there without its page check.
    const open = isCommunityManagerPath(routeOf(file));
    expect(read(file)).toMatch(open ? /await requireStaffPage\(\)/ : /await requireAdminPage\(\)/);
  });
});

describe("every admin server action calls requireAdminAction(), or requireStaffAction() where a community manager may write", () => {
  // Server actions are directly callable POST endpoints: the page's guard doesn't cover them.
  // Admin-only action modules outside src/app/(admin) are listed explicitly.
  const ADMIN_ACTION_FILES_ELSEWHERE = ["src/app/actions/sudo.ts"];
  // Exported actions that are deliberately not admin-only, with the reason.
  const NOT_ADMIN_ONLY: Record<string, string> = {
    // Only clears the caller's own sudo cookies; must keep working even if the role was revoked.
    "src/app/actions/sudo.ts#exitSudo": "clears own cookies",
    "src/app/actions/sudo.ts#exitSudoToAdmin": "clears own cookies, then opens /admin (which checks the role itself)",
  };
  const actionFiles = [
    ...adminFiles.filter((f) => /\.tsx?$/.test(f) && /^\s*["']use server["']/m.test(read(f))),
    ...ADMIN_ACTION_FILES_ELSEWHERE,
  ];
  const actions = actionFiles.flatMap((file) => {
    const src = read(file);
    const starts = [...src.matchAll(/^export (?:async )?function (\w+)/gm)];
    return starts.map((m, i) => {
      const body = src.slice(m.index, starts[i + 1]?.index ?? src.length);
      return [`${file}#${m[1]}`, body] as const;
    });
  });

  it("finds the admin actions", () => {
    expect(actions.map(([id]) => id)).toEqual(
      expect.arrayContaining([
        "src/app/(admin)/admin/hygiene/merge-fix/actions.ts#dismissGroup",
        "src/app/(admin)/admin/hygiene/merge-fix/actions.ts#undismissGroup",
        "src/app/actions/sudo.ts#startSudo",
      ])
    );
  });

  // Action modules a community manager may call, each export opening with requireStaffAction() and then asking for
  // its staff feature (src/lib/staff-access.ts), with the reason. Everything else stays admin-only.
  const STAFF_ACTION_FILES: Record<string, string> = {
    "src/app/(admin)/admin/care/actions.ts": "the community manager writes Hedgie Care (feature care.write)",
  };

  it.each(actions.filter(([id]) => !(id in NOT_ADMIN_ONLY)))("%s", (id, body) => {
    const staffAction = id.split("#")[0] in STAFF_ACTION_FILES;
    expect(body).toMatch(staffAction ? /await requireStaffAction\(\)/ : /await requireAdminAction\(\)/);
    if (staffAction) expect(body).toMatch(/staffCan\(auth\.role, "[a-z_.]+"\)/);
  });
});
