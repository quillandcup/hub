import type { Db } from "@/lib/data/db";

/** A client whose every query answers with a database error: a repository must throw it, not return an empty result. */
export function failingDb(message = "database is down"): Db {
  const answer = { data: null, error: { message, code: "XX000" }, count: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "insert", "update", "upsert", "delete", "eq", "neq", "in", "is", "not", "gt", "gte", "lte", "or", "order", "range", "limit", "like"]) chain[m] = () => chain;
  chain.maybeSingle = async () => answer;
  chain.single = async () => answer;
  chain.then = (resolve: (v: unknown) => unknown) => resolve(answer);
  const client = { from: () => chain, schema: () => client, rpc: async () => answer };
  return client as unknown as Db;
}
