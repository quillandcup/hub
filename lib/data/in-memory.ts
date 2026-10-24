import type { AttendanceRow } from "./attendance";
import type { Prickle, PrickleType } from "./prickles";

/** A member as the in-memory repositories need them: names for hosts and attendees, and the email only admins may see. */
export type MemberSeed = {
  id: string;
  name: string;
  displayName?: string | null;
  email?: string | null;
  /** "active" when not given. */
  status?: string;
  /** "kajabi" when not given. */
  source?: string;
  /** The Supabase Auth user this member signs in as. */
  userId?: string | null;
  staffRole?: string | null;
  kajabiId?: string | null;
  stripeCustomerId?: string | null;
  photoUrl?: string | null;
  bio?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  twitterUrl?: string | null;
  birthdayMonth?: number | null;
  birthdayDay?: number | null;
  selfServiceNameChangedAt?: string | null;
  /** When the row was last written; the Kajabi processing run touches it for every Kajabi member. */
  updatedAt?: string | null;
  totalActiveMonths?: number;
  joinedAt?: string;
  firstJoinedAt?: string | null;
  mostRecentJoinedAt?: string | null;
};

/**
 * The typed tables behind the in-memory repositories. Joins (a prickle's type and host, an
 * attendee's name) read from here, so every in-memory repository over one dataset sees the same
 * world, the way the Supabase ones see one database. Build one in a test, or as a seed profile
 * for demos and docs, with typed rows instead of SQL.
 */
export class InMemoryDataset {
  members: MemberSeed[];
  prickleTypes: PrickleType[];
  prickles: Prickle[];
  attendance: AttendanceRow[];

  constructor(init: Partial<Pick<InMemoryDataset, "members" | "prickleTypes" | "prickles" | "attendance">> = {}) {
    this.members = (init.members ?? []).map((row) => ({ ...row }));
    this.prickleTypes = (init.prickleTypes ?? []).map((row) => ({ ...row }));
    this.prickles = (init.prickles ?? []).map((row) => ({ ...row }));
    this.attendance = (init.attendance ?? []).map((row) => ({ ...row }));
  }
}
