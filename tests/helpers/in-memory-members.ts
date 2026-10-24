import { vi } from "vitest";
import type { MemberSeed } from "@/lib/data/in-memory";

/**
 * For a `vi.mock("@/lib/data/repos", ...)` factory in a route test whose fake Supabase client
 * answers every other table: the real repositories over that client, except members, which come
 * from `rows()` in memory. `rows` is read when the route asks, so a test can set it per case.
 *
 *   vi.mock("@/lib/data/repos", () => import("@/tests/helpers/in-memory-members").then((m) => m.reposWithInMemoryMembers(() => memberRows)))
 */
export async function reposWithInMemoryMembers(rows: () => MemberSeed[]) {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  const { InMemoryDataset } = await import("@/lib/data/in-memory");
  return {
    ...actual,
    createRepos: (db: Parameters<typeof actual.createRepos>[0]) => ({
      ...actual.createRepos(db),
      members: actual.createInMemoryRepos(new InMemoryDataset({ members: rows() })).members,
    }),
  };
}
