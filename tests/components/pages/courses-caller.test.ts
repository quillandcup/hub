import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_USER,
  MEMBER_IDENTITY,
  MEMBER_USER,
  expectRedirect,
  resetServerPageMocks,
  signInAs,
} from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

// The caller's profile (role) comes from the profile repository, in memory here.
let dataset = new InMemoryDataset();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => createInMemoryRepos(dataset),
}));
/** Gives the signed-in user a profile with this role. */
const withRole = (user: { id: string; email?: string }, role: "admin" | "member") => {
  dataset = new InMemoryDataset({ userProfiles: [{ id: user.id, email: user.email ?? "", role }] });
};

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
  dataset = new InMemoryDataset();
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
    withRole(MEMBER_USER, "member");
    expect(await getCoursesCaller()).toBeNull();

    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    flagOn = false;
    expect(await getCoursesCaller()).toBeNull();
  });

  it("scopes a member to their own access", async () => {
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    withRole(MEMBER_USER, "member");
    expect(await getCoursesCaller()).toMatchObject({ scope: { memberId: MEMBER_IDENTITY.memberId, isAdminActing: false } });
    expect(effectiveMemberHasFeature).toHaveBeenCalledWith("courses", MEMBER_IDENTITY, []);
  });

  it("lets staff open every course, but only as themselves, not in sudo", async () => {
    withRole(ADMIN_USER, "admin");
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
    withRole(MEMBER_USER, "member");
    flagOn = false;
    await expectRedirect(requireAndDiscard, undefined, "/dashboard");
  });

  it("returns the caller when everything checks out", async () => {
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    withRole(MEMBER_USER, "member");
    expect(await requireCoursesPage()).toMatchObject({ identity: MEMBER_IDENTITY });
  });
});
