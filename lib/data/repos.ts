import { SupabaseAttendanceRepository, type AttendanceRepository } from "./attendance";
import type { Db } from "./db";

/**
 * Every repository, one per aggregate. Pages, actions and routes depend on these interfaces, not on
 * Supabase, so tests pass in-memory twins (`InMemoryAttendanceRepository`, ...) and only the
 * repositories' own tests need a database. New aggregates are added here.
 */
export interface Repos {
  attendance: AttendanceRepository;
}

/** Repositories over one client. Which privilege they run with is the client's: user-scoped (RLS) or service role. */
export function createRepos(db: Db): Repos {
  return { attendance: new SupabaseAttendanceRepository(db) };
}
