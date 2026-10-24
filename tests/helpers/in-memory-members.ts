import { vi } from "vitest";
import type { MemberSeed } from "@/lib/data/in-memory";

/**
 * For a `vi.mock("@/lib/data/repos", ...)` factory in a route test whose fake Supabase client
 * answers every other table: the real repositories over that client, except members, which come
 * from `rows()` in memory. `rows` is read when the route asks, so a test can set it per case.
 *
 * Writes that merge, split and delete rely on are also appended to the client's `calls` log (when it
 * has one, as `createFakeSupabase` does) in the shape the old direct queries had, so a test can check
 * their order against the other tables' writes.
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
      members: recordWrites(db, actual.createInMemoryRepos(new InMemoryDataset({ members: rows() })).members),
    }),
  };
}

type Call = { table: string; op: string; payload?: unknown; filters: unknown[] };

function recordWrites<T extends object>(db: unknown, members: T): T {
  const calls = (db as { calls?: Call[] } | null)?.calls;
  if (!Array.isArray(calls)) return members;
  const record = (op: string, payload: unknown, filters: unknown[]) => calls.push({ table: "members", op, payload, filters });
  const repo = members as unknown as {
    delete(id: string): Promise<void>;
    setExternalIds(id: string, ids: { kajabiId?: string; stripeCustomerId?: string; userId?: string }): Promise<void>;
    create(m: { name: string; email: string; joinedAt: string; status: string; source: string }): Promise<string>;
  };
  return new Proxy(members, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);
      if (prop === "delete") return (id: string) => (record("delete", undefined, [["eq", "id", id]]), repo.delete.call(target, id));
      if (prop === "setExternalIds") {
        return (id: string, ids: { kajabiId?: string; stripeCustomerId?: string; userId?: string }) => {
          const payload: Record<string, string> = {};
          if (ids.kajabiId !== undefined) payload.kajabi_id = ids.kajabiId;
          if (ids.stripeCustomerId !== undefined) payload.stripe_customer_id = ids.stripeCustomerId;
          if (ids.userId !== undefined) payload.user_id = ids.userId;
          record("update", payload, [["eq", "id", id]]);
          return repo.setExternalIds.call(target, id, ids);
        };
      }
      if (prop === "create") {
        return (m: { name: string; email: string; joinedAt: string; status: string; source: string }) => {
          record("insert", { name: m.name, email: m.email, joined_at: m.joinedAt, status: m.status, source: m.source }, []);
          return repo.create.call(target, m);
        };
      }
      return typeof original === "function" ? original.bind(target) : original;
    },
  });
}
