import { fetchAllRows } from "@/lib/supabase/paginate";
import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";

/**
 * Who interacted with whom in chat (`member_interactions`, Silver, rebuilt from the chat mirror by
 * `/api/process/member-interactions`): a DM, a thread reply, a reaction or a mention, with when and whether it was in the
 * open, never what was said. Reads only; the rebuild writes with the service role through its own RPC. Methods throw on
 * a database error: a failed read must not look like "no one".
 */
export interface MemberInteractionRepository {
  /**
   * The distinct members this member interacted with, either way (they wrote to or reacted to someone, or someone did
   * toward them), from `fromIso` up to, not including, `toIso`. Paginated past 1000 rows with a stable order. The member is
   * never in their own set.
   */
  counterpartsBetween(memberId: string, fromIso: string, toIso: string): Promise<Set<string>>;
}

type Pair = { member_a: string; member_b: string };

function counterparts(rows: Pair[], memberId: string): Set<string> {
  const out = new Set<string>();
  for (const r of rows) out.add(r.member_a === memberId ? r.member_b : r.member_a);
  out.delete(memberId);
  return out;
}

export class SupabaseMemberInteractionRepository implements MemberInteractionRepository {
  constructor(private readonly db: Db) {}

  async counterpartsBetween(memberId: string, fromIso: string, toIso: string) {
    const rows = await fetchAllRows<Pair>((from, to) =>
      this.db
        .from("member_interactions")
        .select("member_a, member_b")
        .or(`member_a.eq.${memberId},member_b.eq.${memberId}`)
        .gte("occurred_at", fromIso)
        .lt("occurred_at", toIso)
        .order("id")
        .range(from, to)
    );
    return counterparts(rows, memberId);
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryMemberInteractionRepository implements MemberInteractionRepository {
  constructor(private readonly data: InMemoryDataset) {}

  async counterpartsBetween(memberId: string, fromIso: string, toIso: string) {
    const from = Date.parse(fromIso);
    const to = Date.parse(toIso);
    return counterparts(
      this.data.memberInteractions.filter(
        (r) => (r.member_a === memberId || r.member_b === memberId) && Date.parse(r.occurred_at) >= from && Date.parse(r.occurred_at) < to
      ),
      memberId
    );
  }
}
