// @vitest-environment jsdom
/**
 * The secure admin checks behind proxy.ts's optimistic /admin pre-filter (lib/admin-auth.ts):
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

vi.mock("@/lib/features.server", () => ({ getUserFeaturePreviews: vi.fn(async () => []) }));
vi.mock("@/app/(admin)/admin/AdminNavigation", () => ({ default: () => <nav data-testid="admin-nav" /> }));
vi.mock("@/components/UserMenu", () => ({
  default: ({ userEmail }: { userEmail: string }) => <div data-testid="user-menu">{userEmail}</div>,
}));
vi.mock("@/components/FeedbackWidget", () => ({ default: () => null }));
vi.mock("@/components/SignOutButton", () => ({ default: () => <button>Sign Out</button> }));

import { requireAdminAction, requireAdminPage } from "@/lib/admin-auth";
import AdminLayout from "@/app/(admin)/layout";
import AdminWheelOfWonderPage from "@/app/(admin)/admin/wheel-of-wonder/page";
import StreaksPage from "@/app/(member)/streaks/page";
import NoAccessPage from "@/app/no-access/page";
import { dismissGroup, undismissGroup } from "@/app/(admin)/admin/hygiene/merge-fix/actions";
import { SUPPORT_EMAIL } from "@/lib/config"

const ROLES: Record<string, string> = { [ADMIN_USER.id]: "admin", [MEMBER_USER.id]: "member" };
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

describe("admin layout", () => {
  it("renders the admin shell and page for an admin", async () => {
    signInAs(ADMIN_USER, null);
    await renderServerPage(AdminLayout, layoutProps);
    expect(screen.getByTestId("admin-nav")).toBeInTheDocument();
    expect(screen.getByTestId("user-menu")).toHaveTextContent(ADMIN_USER.email!);
    expect(screen.getByText("admin page body")).toBeInTheDocument();
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
const adminRoot = path.join(repoRoot, "app/(admin)");
const adminFiles = (fs.readdirSync(adminRoot, { recursive: true }) as string[]).map((f) =>
  path.join("app/(admin)", f)
);
const read = (file: string) => fs.readFileSync(path.join(repoRoot, file), "utf8");

describe("every admin page calls requireAdminPage()", () => {
  // Layouts don't re-run on client navigation and don't stop a page segment from rendering.
  const pages = adminFiles.filter((f) => f.endsWith("page.tsx"));

  it("finds the admin pages", () => {
    expect(pages.length).toBeGreaterThan(40);
  });

  it.each(pages)("%s", (file) => {
    expect(read(file)).toMatch(/await requireAdminPage\(\)/);
  });
});

describe("every admin server action calls requireAdminAction()", () => {
  // Server actions are directly callable POST endpoints: the page's guard doesn't cover them.
  // Admin-only action modules outside app/(admin) are listed explicitly.
  const ADMIN_ACTION_FILES_ELSEWHERE = ["app/actions/sudo.ts"];
  // Exported actions that are deliberately not admin-only, with the reason.
  const NOT_ADMIN_ONLY: Record<string, string> = {
    // Only clears the caller's own sudo cookies; must keep working even if the role was revoked.
    "app/actions/sudo.ts#exitSudo": "clears own cookies",
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
        "app/(admin)/admin/hygiene/merge-fix/actions.ts#dismissGroup",
        "app/(admin)/admin/hygiene/merge-fix/actions.ts#undismissGroup",
        "app/actions/sudo.ts#startSudo",
      ])
    );
  });

  it.each(actions.filter(([id]) => !(id in NOT_ADMIN_ONLY)))("%s", (_id, body) => {
    expect(body).toMatch(/await requireAdminAction\(\)/);
  });
});
