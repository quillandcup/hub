// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ADMIN_USER, MEMBER_USER, expectRedirect, renderServerPage, resetServerPageMocks, signInAs, useFakeSupabase, type FakeQuery } from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/app/(admin)/admin/media/MediaLibraryClient", () => ({ default: () => <div data-testid="library" /> }));

import MediaPage from "@/app/(admin)/admin/media/page";

const ROLES: Record<string, string> = { [ADMIN_USER.id]: "admin", [MEMBER_USER.id]: "member" };
const userProfiles = (q: FakeQuery) => {
  const id = q.calls.find((c) => c.method === "eq" && c.args[0] === "id")?.args[1] as string;
  return { data: ROLES[id] ? [{ role: ROLES[id] }] : [] };
};

beforeEach(() => {
  resetServerPageMocks();
  useFakeSupabase({ user_profiles: userProfiles });
});

describe("admin media page", () => {
  it("shows the library to an admin", async () => {
    signInAs(ADMIN_USER, null);
    await renderServerPage(MediaPage, {});
    expect(screen.getByRole("heading", { name: "Media" })).toBeInTheDocument();
    expect(screen.getByTestId("library")).toBeInTheDocument();
  });

  it("sends a member to /no-access and a signed-out visitor to /login", async () => {
    signInAs(MEMBER_USER, null);
    await expectRedirect(MediaPage, {}, "/no-access");
    signInAs(null);
    await expectRedirect(MediaPage, {}, "/login");
  });
});
