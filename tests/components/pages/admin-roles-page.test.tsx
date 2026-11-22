// @vitest-environment jsdom
/**
 * The Roles page (src/app/(admin)/admin/roles): a read-only matrix generated from the permission registry. The guard
 * is the real `requirePermission`, so which roles may open it is the registry's own answer.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import {
  ADMIN_USER,
  expectRedirect,
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
vi.mock("@/lib/staff-preview.server", () => ({ getStaffPreviewRole: async () => null }));
vi.mock("@/lib/staff-mfa.server", () => ({ getStaffMfaState: async () => "ok" }));

import RolesPage from "@/app/(admin)/admin/roles/page";
import { buildPermissionMatrix } from "@/lib/permission-matrix";
import {
  ALL_PERMISSIONS,
  ASSISTANT_WITHHELD,
  ASSISTANT_WITHHELD_REASONS,
  PERMISSIONS,
  RESERVED_PERMISSIONS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  STAFF_ROLES,
} from "@/lib/permissions";

const USERS: Record<string, string> = {
  "user-assistant": "assistant",
  "user-community-manager": "community_manager",
  "user-conversion-specialist": "conversion_specialist",
  [ADMIN_USER.id]: "admin",
};
const userProfiles = (q: FakeQuery) => {
  const id = q.calls.find((c) => c.method === "eq" && c.args[0] === "id")?.args[1] as string;
  return { data: USERS[id] ? [{ role: USERS[id] }] : [] };
};
const signedInAs = (id: string) => signInAs({ id, email: `${id}@example.test` }, null);

beforeEach(() => {
  resetServerPageMocks();
  useFakeSupabase({ user_profiles: userProfiles });
});

/** The row header of one permission: its accessible name starts with the permission's own name. */
const rowHeaderOf = (permission: string) => screen.getByRole("rowheader", { name: (name) => name.split(" ")[0] === permission });

/** The row of one permission: its row header and the marks in the role columns. */
function rowOf(permission: string) {
  return rowHeaderOf(permission).closest("tr") as HTMLElement;
}
const marksOf = (permission: string) => within(rowOf(permission)).getAllByRole("cell").map((cell) => cell.textContent);

describe("Roles page access", () => {
  it.each(["user-admin-bramble", "user-assistant"])("renders for %s", async (id) => {
    signedInAs(id);
    await renderServerPage(RolesPage, {});
    expect(screen.getByRole("heading", { level: 1, name: "Roles" })).toBeInTheDocument();
  });

  it.each(["user-community-manager", "user-conversion-specialist"])("sends %s to /no-access", async (id) => {
    signedInAs(id);
    await expectRedirect(RolesPage, {}, "/no-access");
  });
});

describe("Roles page content, generated from the registry", () => {
  beforeEach(async () => {
    signedInAs("user-admin-bramble");
    await renderServerPage(RolesPage, {});
  });

  it("says a person can hold several roles and may do the union", () => {
    expect(screen.getByText(/A person can hold several roles and may do whatever any of them allows/)).toBeInTheDocument();
  });

  it("shows every permission with its description, and a column and a summary for every role", () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(rowHeaderOf(permission)).toHaveTextContent(PERMISSIONS[permission]);
    }
    const columns = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(columns).toEqual(["Permission", ...STAFF_ROLES.map((r) => ROLE_LABELS[r])]);
    const summary = within(screen.getByRole("list", { name: "Roles" }));
    for (const role of STAFF_ROLES) {
      const card = summary.getByRole("heading", { name: ROLE_LABELS[role] }).closest("li") as HTMLElement;
      expect(card).toHaveTextContent(ROLE_DESCRIPTIONS[role]);
      expect(card).toHaveTextContent(`${ROLE_PERMISSIONS[role].length} of ${ALL_PERMISSIONS.length} permissions`);
    }
  });

  it("groups the permissions by the part before the first dot", () => {
    const areas = new Set(ALL_PERMISSIONS.map((p) => p.split(".")[0]));
    for (const area of areas) expect(screen.getAllByText(area, { selector: "div" })).toHaveLength(1);
    expect(document.querySelectorAll("tbody")).toHaveLength(areas.size);
  });

  it("marks every cell with accessible text, matching what each role holds", () => {
    for (const permission of ALL_PERMISSIONS) {
      const expected = STAFF_ROLES.map((role) => {
        if (role === "assistant" && ASSISTANT_WITHHELD.includes(permission)) return "Withheld on purpose";
        return ROLE_PERMISSIONS[role].includes(permission) ? "Has it" : "Does not have it";
      });
      expect(marksOf(permission)).toEqual(expected);
    }
  });

  it("uses scope on every header", () => {
    for (const header of screen.getAllByRole("columnheader")) expect(header).toHaveAttribute("scope", "col");
    for (const header of screen.getAllByRole("rowheader")) expect(header).toHaveAttribute("scope", expect.stringMatching(/^(row|rowgroup)$/));
    expect(screen.getByRole("table")).toHaveAccessibleName("Which roles hold each permission");
  });

  it("explains each reserved permission, and only those", () => {
    expect(RESERVED_PERMISSIONS.length).toBeGreaterThan(0);
    for (const permission of ALL_PERMISSIONS) {
      const reserved = RESERVED_PERMISSIONS.includes(permission);
      expect(rowOf(permission).textContent?.includes("no page, action or route checks it yet")).toBe(reserved);
    }
  });

  it("says why the assistant's withheld permission is withheld", () => {
    expect(ASSISTANT_WITHHELD.length).toBeGreaterThan(0);
    for (const permission of ASSISTANT_WITHHELD) {
      expect(rowOf(permission)).toHaveTextContent(`Withheld from the assistant: ${ASSISTANT_WITHHELD_REASONS[permission]}`);
    }
    const others = ALL_PERMISSIONS.filter((p) => !ASSISTANT_WITHHELD.includes(p));
    expect(rowOf(others[0]).textContent).not.toContain("Withheld from the assistant");
  });

  it("filters by permission text, and by a role to list what it holds", async () => {
    const search = screen.getByRole("searchbox", { name: "Search permissions or roles" });
    await userEvent.type(search, "outreach");
    expect(screen.getByRole("rowheader", { name: /^outreach\.manage/ })).toBeInTheDocument();
    expect(screen.queryByRole("rowheader", { name: /^members\.read/ })).not.toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, "Conversion Specialist");
    const shown = screen.getAllByRole("rowheader").filter((h) => h.getAttribute("scope") === "row").length;
    expect(shown).toBe(ROLE_PERMISSIONS.conversion_specialist.length);

    await userEvent.clear(search);
    await userEvent.type(search, "zzzz-no-such");
    expect(screen.getByText("No permission or role matches that search.")).toBeInTheDocument();
  });
});

describe("Roles page is derived", () => {
  it("lists exactly the registry in the matrix data", () => {
    const matrix = buildPermissionMatrix();
    expect(matrix.areas.flatMap((a) => a.rows.map((r) => r.permission)).sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(matrix.roles.map((r) => r.role)).toEqual([...STAFF_ROLES]);
  });

  it("gives every withheld permission a reason and every role a description", () => {
    for (const permission of ASSISTANT_WITHHELD) expect(ASSISTANT_WITHHELD_REASONS[permission]).toBeTruthy();
    for (const role of STAFF_ROLES) expect(ROLE_DESCRIPTIONS[role]).toBeTruthy();
  });

  it("types no permission or role name in the component or the matrix builder", () => {
    for (const file of ["src/app/(admin)/admin/roles/RolesClient.tsx", "src/lib/permission-matrix.ts"]) {
      const source = readFileSync(file, "utf8");
      for (const permission of ALL_PERMISSIONS) expect(source, `${file} names ${permission}`).not.toContain(`"${permission}"`);
      for (const role of STAFF_ROLES) expect(source, `${file} names ${role}`).not.toMatch(new RegExp(`["']${role}["']`));
      for (const label of Object.values(ROLE_LABELS)) expect(source, `${file} names ${label}`).not.toContain(`"${label}"`);
    }
  });
});
