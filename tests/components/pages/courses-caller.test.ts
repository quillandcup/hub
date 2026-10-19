import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_USER,
  MEMBER_IDENTITY,
  MEMBER_USER,
  expectRedirect,
  resetServerPageMocks,
  signInAs,
  useFakeSupabase,
} from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));

let flagOn = true;
const effectiveMemberHasFeature = vi.fn(async (..._args: unknown[]) => flagOn);
vi.mock("@/lib/features.server", () => ({
  getUserFeaturePreviews: async () => [],
  effectiveMemberHasFeature: (...args: unknown[]) => effectiveMemberHasFeature(...args),
}));

import { getCoursesCaller, requireCoursesPage } from "@/lib/courses/caller";

beforeEach(() => {
  resetServerPageMocks();
  effectiveMemberHasFeature.mockClear();
  flagOn = true;
});

/** requireCoursesPage returns the caller, not JSX; expectRedirect only cares that it redirects. */
const requireAndDiscard = async () => {
  await requireCoursesPage();
  return null;
};

describe("getCoursesCaller", () => {
  it("is null when signed out, without a member record, or with courses off", async () => {
    signInAs(null);
    expect(await getCoursesCaller()).toBeNull();

    signInAs(MEMBER_USER, null);
    useFakeSupabase({ user_profiles: { data: { role: "member" } } });
    expect(await getCoursesCaller()).toBeNull();

    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    flagOn = false;
    expect(await getCoursesCaller()).toBeNull();
  });

  it("scopes a member to their own access", async () => {
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    useFakeSupabase({ user_profiles: { data: { role: "member" } } });
    expect(await getCoursesCaller()).toMatchObject({ scope: { memberId: MEMBER_IDENTITY.memberId, isAdminActing: false } });
    expect(effectiveMemberHasFeature).toHaveBeenCalledWith("courses", MEMBER_IDENTITY, []);
  });

  it("lets staff open every course, but only as themselves, not in sudo", async () => {
    useFakeSupabase({ user_profiles: { data: { role: "admin" } } });
    signInAs(ADMIN_USER, { ...MEMBER_IDENTITY, isSudo: false });
    expect((await getCoursesCaller())?.scope.isAdminActing).toBe(true);

    signInAs(ADMIN_USER, { ...MEMBER_IDENTITY, isSudo: true });
    expect((await getCoursesCaller())?.scope.isAdminActing).toBe(false);
  });
});

describe("requireCoursesPage", () => {
  it("sends a signed-out visitor to /login, an admin without a member record to /admin, and everyone else without the feature to /dashboard", async () => {
    signInAs(null);
    await expectRedirect(requireAndDiscard, undefined, "/login");

    signInAs(ADMIN_USER, null);
    await expectRedirect(requireAndDiscard, undefined, "/admin");

    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    useFakeSupabase({ user_profiles: { data: { role: "member" } } });
    flagOn = false;
    await expectRedirect(requireAndDiscard, undefined, "/dashboard");
  });

  it("returns the caller when everything checks out", async () => {
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    useFakeSupabase({ user_profiles: { data: { role: "member" } } });
    expect(await requireCoursesPage()).toMatchObject({ identity: MEMBER_IDENTITY });
  });
});
