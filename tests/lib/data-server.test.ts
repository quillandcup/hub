import { beforeEach, describe, expect, it, vi } from "vitest";

const userClient = { who: "user" };
const serviceClient = { who: "service" };
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => userClient) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: vi.fn(() => serviceClient) }));

import { SupabaseAttendanceRepository } from "@/lib/data/attendance";
import { getRepos, getServiceRepos } from "@/lib/data/server";
import { createRepos } from "@/lib/data/repos";

beforeEach(() => vi.clearAllMocks());

describe("repository factories", () => {
  it("getRepos builds the repositories over the signed-in caller's client", async () => {
    const repos = await getRepos();
    expect(repos.attendance).toBeInstanceOf(SupabaseAttendanceRepository);
    expect((repos.attendance as unknown as { db: unknown }).db).toBe(userClient);
  });

  it("getServiceRepos builds them over the service-role client", () => {
    const repos = getServiceRepos();
    expect((repos.attendance as unknown as { db: unknown }).db).toBe(serviceClient);
  });

  it("createRepos uses exactly the client it is given", () => {
    const db = { who: "other" } as never;
    expect((createRepos(db).attendance as unknown as { db: unknown }).db).toBe(db);
  });
});
