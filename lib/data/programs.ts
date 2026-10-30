import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import type { Db, Insert, Row, Update } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** A program (180 Program, Self-Editing Academy, ...): what members enroll in, one cohort at a time. */
export type Program = Row<"programs">;
export type NewProgram = Insert<"programs">;
export type ProgramPatch = Update<"programs">;
/** A run of a program with a start and an expiry. */
export type ProgramCohort = Row<"program_cohorts">;
export type NewProgramCohort = Insert<"program_cohorts">;
export type ProgramCohortPatch = Update<"program_cohorts">;
/** A member's place in one cohort (one row per member and cohort). */
export type ProgramEnrollment = Row<"member_program_enrollments">;
export type NewProgramEnrollment = Insert<"member_program_enrollments">;

/** A program with how many cohorts and enrollments it has. */
export type ProgramWithCounts = Program & { cohort_count: number; enrollment_count: number };

/** A cohort with its enrollments and who enrolled (the shape the admin program page reads). */
export type CohortWithEnrollments = ProgramCohort & {
  member_program_enrollments: {
    id: string;
    notes: string | null;
    created_at: string;
    member: { id: string; name: string; display_name: string | null; email: string; status: string } | null;
  }[];
};

/** A cohort and the Kajabi offer names of its program (what matching Kajabi purchases to the cohort needs). */
export type CohortForMatching = {
  id: string;
  starts_at: string;
  expires_at: string;
  program: { id: string; kajabi_offer_names: string[] } | null;
};

/** A new enrollment, with the member it is for. */
export type EnrollmentWithMember = ProgramEnrollment & { member: { id: string; name: string; email: string } | null };

/** One of a member's enrollments with its cohort and program joined in, newest first. */
export type MemberEnrollment = {
  id: string;
  createdAt: string;
  cohortId: string;
  programId: string;
  programName: string;
  includesMembership: boolean;
  startsAt: string;
  expiresAt: string;
};

/** When a member's cohort ends, and of which program: what program completions are counted from. */
export type EnrollmentCohortEnd = { memberId: string; programId: string; expiresAt: string };

/** An enrollment in a cohort of a program that includes membership: how a member arrived through a program. */
export type ProgramArrival = {
  startsOn: string;
  programName: string | null;
  /** Null when the member no longer exists. */
  member: { id: string; name: string; display_name: string | null; email: string; staff_role: string | null } | null;
};

/** Thrown by {@link ProgramRepository.enroll} when the member is already in that cohort. */
export class ProgramEnrollmentExistsError extends Error {
  constructor() {
    super("This member is already enrolled in this cohort");
    this.name = "ProgramEnrollmentExistsError";
  }
}

// Small chunks: long `.in()` lists fail with "URI too long".
const ID_CHUNK = 100;

/** Asc order on strings, with the id as the tie-break so pages never repeat or skip a row. */
const byKey = <T>(key: (row: T) => string, id: (row: T) => string, descending = false) => (a: T, b: T) => {
  const x = key(a);
  const y = key(b);
  if (x !== y) return (x < y ? -1 : 1) * (descending ? -1 : 1);
  return id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0;
};

/** PostgREST returns a to-one embed as an object, though callers have also met it as a one-item array. */
function one<T>(embed: T | T[] | null | undefined): T | null {
  return (Array.isArray(embed) ? embed[0] : embed) ?? null;
}

/**
 * Programs, their cohorts and the members enrolled in them (`programs`, `program_cohorts`,
 * `member_program_enrollments`). Local data: these tables are the source of truth, not reprocessed.
 * Every method throws on a database error. A cohort or enrollment is deleted with its program, and an
 * enrollment with its cohort.
 */
export interface ProgramRepository {
  // --- programs ---
  /** Every program's id and name, by name. */
  names(): Promise<Pick<Program, "id" | "name">[]>;
  /** Every program with its cohort and enrollment counts, by name. */
  listWithCounts(): Promise<ProgramWithCounts[]>;
  /** One program, or null when there is none. */
  byId(id: string): Promise<Program | null>;
  /** The id of the program with this slug, or null. */
  idBySlug(slug: string): Promise<string | null>;
  create(program: NewProgram): Promise<Program>;
  /** Changes a program and returns it. Throws when there is no such program. */
  update(id: string, patch: ProgramPatch): Promise<Program>;
  delete(id: string): Promise<void>;

  // --- cohorts ---
  /** A program's cohorts, latest start first, each with its enrollments (oldest first) and the members in them. */
  cohortsWithEnrollments(programId: string): Promise<CohortWithEnrollments[]>;
  /** One cohort with its program's Kajabi offer names, or null when there is no such cohort. */
  cohortForMatching(cohortId: string): Promise<CohortForMatching | null>;
  createCohort(cohort: NewProgramCohort): Promise<ProgramCohort>;
  /** Changes a cohort and returns it. Throws when there is no such cohort. */
  updateCohort(id: string, patch: ProgramCohortPatch): Promise<ProgramCohort>;
  deleteCohort(id: string): Promise<void>;
  /**
   * Which of these members are already in another cohort of the program, by the name of the cohort
   * they joined first. A member in none is left out. Chunked.
   */
  enrolledElsewhere(programId: string, exceptCohortId: string, memberIds: string[]): Promise<Map<string, string>>;

  // --- enrollments ---
  /** Enrolls a member and returns the enrollment with the member. Throws {@link ProgramEnrollmentExistsError} when they are already in the cohort. */
  enroll(enrollment: NewProgramEnrollment): Promise<EnrollmentWithMember>;
  /** Removes an enrollment. */
  unenroll(id: string): Promise<void>;
  /** The members enrolled in a cohort. Paginated. */
  memberIdsInCohort(cohortId: string): Promise<Set<string>>;
  /**
   * Moves every enrollment of one member to another (a member merge). Where the target is already in
   * the same cohort the duplicate is deleted instead, since a member is in a cohort once.
   */
  moveEnrollments(fromMemberId: string, toMemberId: string): Promise<void>;
  /** A member's enrollments with their cohort and program, newest first. */
  enrollmentsOf(memberId: string): Promise<MemberEnrollment[]>;
  /** The end of every member's cohorts, with the program. Paginated. */
  allEnrollmentCohorts(): Promise<EnrollmentCohortEnd[]>;
  /** Enrollments in cohorts that start between these dates (inclusive, YYYY-MM-DD) of programs that include membership. Paginated. */
  membershipArrivals(sinceDate: string, today: string): Promise<ProgramArrival[]>;
}

type CohortEmbed = { program_id: string; starts_at: string; expires_at: string; program: { name: string; includes_membership: boolean } | { name: string; includes_membership: boolean }[] | null };
type EnrollmentEmbedRow = { id: string; created_at: string; cohort_id: string; cohort: CohortEmbed | CohortEmbed[] | null };
type ArrivalEmbedRow = {
  program_cohorts: { starts_at: string; programs: { name: string } | { name: string }[] | null };
  members: NonNullable<ProgramArrival["member"]> | NonNullable<ProgramArrival["member"]>[] | null;
};
type EndEmbedRow = { member_id: string; program_cohorts: { program_id: string; expires_at: string } | { program_id: string; expires_at: string }[] | null };

export class SupabaseProgramRepository implements ProgramRepository {
  constructor(private readonly db: Db) {}

  async names() {
    const { data, error } = await this.db.from("programs").select("id, name").order("name").order("id");
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async listWithCounts() {
    const { data, error } = await this.db.from("programs").select("*, program_cohorts(id, member_program_enrollments(id))").order("name").order("id");
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as (Program & { program_cohorts: { id: string; member_program_enrollments: { id: string }[] }[] | null })[]).map(({ program_cohorts, ...program }) => ({
      ...program,
      cohort_count: program_cohorts?.length ?? 0,
      enrollment_count: (program_cohorts ?? []).reduce((sum, c) => sum + (c.member_program_enrollments?.length ?? 0), 0),
    }));
  }

  async byId(id: string) {
    const { data, error } = await this.db.from("programs").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async idBySlug(slug: string) {
    const { data, error } = await this.db.from("programs").select("id").eq("slug", slug).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.id ?? null;
  }

  async create(program: NewProgram) {
    const { data, error } = await this.db.from("programs").insert(program).select("*").single();
    if (error) throw new Error(error.message);
    return data;
  }

  async update(id: string, patch: ProgramPatch) {
    const { data, error } = await this.db.from("programs").update(patch).eq("id", id).select("*").single();
    if (error) throw new Error(error.message);
    return data;
  }

  async delete(id: string) {
    const { error } = await this.db.from("programs").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  async cohortsWithEnrollments(programId: string) {
    const { data, error } = await this.db
      .from("program_cohorts")
      .select("*, member_program_enrollments(id, notes, created_at, member:members(id, name, display_name, email, status))")
      .eq("program_id", programId)
      .order("starts_at", { ascending: false })
      .order("id")
      .order("created_at", { referencedTable: "member_program_enrollments" })
      .order("id", { referencedTable: "member_program_enrollments" });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as CohortWithEnrollments[];
  }

  async cohortForMatching(cohortId: string) {
    const { data, error } = await this.db.from("program_cohorts").select("id, starts_at, expires_at, program:programs(id, kajabi_offer_names)").eq("id", cohortId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const row = data as unknown as Omit<CohortForMatching, "program"> & { program: CohortForMatching["program"] | NonNullable<CohortForMatching["program"]>[] };
    return { id: row.id, starts_at: row.starts_at, expires_at: row.expires_at, program: one(row.program) };
  }

  async createCohort(cohort: NewProgramCohort) {
    const { data, error } = await this.db.from("program_cohorts").insert(cohort).select("*").single();
    if (error) throw new Error(error.message);
    return data;
  }

  async updateCohort(id: string, patch: ProgramCohortPatch) {
    const { data, error } = await this.db.from("program_cohorts").update(patch).eq("id", id).select("*").single();
    if (error) throw new Error(error.message);
    return data;
  }

  async deleteCohort(id: string) {
    const { error } = await this.db.from("program_cohorts").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  async enrolledElsewhere(programId: string, exceptCohortId: string, memberIds: string[]) {
    const result = new Map<string, string>();
    if (memberIds.length === 0) return result;

    const { data: cohorts, error } = await this.db.from("program_cohorts").select("id, name").eq("program_id", programId).neq("id", exceptCohortId).order("id");
    if (error) throw new Error(error.message);
    const names = new Map((cohorts ?? []).map((c) => [c.id, c.name]));
    if (names.size === 0) return result;

    for (const part of chunk([...new Set(memberIds)], ID_CHUNK)) {
      const rows = await fetchAllRows<{ member_id: string; cohort_id: string }>(
        (from, to) =>
          this.db
            .from("member_program_enrollments")
            .select("member_id, cohort_id")
            .in("member_id", part)
            .in("cohort_id", [...names.keys()])
            .order("created_at")
            .order("id")
            .range(from, to) as unknown as PromiseLike<{ data: { member_id: string; cohort_id: string }[] | null; error: { message: string } | null }>
      );
      for (const row of rows) if (!result.has(row.member_id)) result.set(row.member_id, names.get(row.cohort_id) ?? "another cohort");
    }
    return result;
  }

  async enroll(enrollment: NewProgramEnrollment) {
    const { data, error } = await this.db.from("member_program_enrollments").insert(enrollment).select("*, member:members(id, name, email)").single();
    if (error) {
      if (error.code === "23505") throw new ProgramEnrollmentExistsError();
      throw new Error(error.message);
    }
    return data as unknown as EnrollmentWithMember;
  }

  async unenroll(id: string) {
    const { error } = await this.db.from("member_program_enrollments").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  async memberIdsInCohort(cohortId: string) {
    const rows = await fetchAllRows<{ member_id: string }>(
      (from, to) =>
        this.db.from("member_program_enrollments").select("member_id").eq("cohort_id", cohortId).order("id").range(from, to) as unknown as PromiseLike<{
          data: { member_id: string }[] | null;
          error: { message: string } | null;
        }>
    );
    return new Set(rows.map((r) => r.member_id));
  }

  async moveEnrollments(fromMemberId: string, toMemberId: string) {
    const [target, source] = await Promise.all([
      this.db.from("member_program_enrollments").select("cohort_id").eq("member_id", toMemberId),
      this.db.from("member_program_enrollments").select("id, cohort_id").eq("member_id", fromMemberId),
    ]);
    if (target.error) throw new Error(target.error.message);
    if (source.error) throw new Error(source.error.message);

    const targetCohorts = new Set((target.data ?? []).map((e) => e.cohort_id));
    const duplicates = (source.data ?? []).filter((e) => targetCohorts.has(e.cohort_id)).map((e) => e.id);
    const movable = (source.data ?? []).filter((e) => !targetCohorts.has(e.cohort_id)).map((e) => e.id);

    const results = await Promise.all([
      ...chunk(duplicates, ID_CHUNK).map((part) => this.db.from("member_program_enrollments").delete().in("id", part)),
      ...chunk(movable, ID_CHUNK).map((part) => this.db.from("member_program_enrollments").update({ member_id: toMemberId }).in("id", part)),
    ]);
    const failed = results.find((r) => r.error);
    if (failed?.error) throw new Error(failed.error.message);
  }

  async enrollmentsOf(memberId: string) {
    const { data, error } = await this.db
      .from("member_program_enrollments")
      .select("id, created_at, cohort_id, cohort:program_cohorts(program_id, starts_at, expires_at, program:programs(name, includes_membership))")
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .order("id");
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as EnrollmentEmbedRow[]).flatMap((row) => {
      const cohort = one(row.cohort);
      const program = cohort && one(cohort.program);
      if (!cohort || !program) return [];
      return [{ id: row.id, createdAt: row.created_at, cohortId: row.cohort_id, programId: cohort.program_id, programName: program.name, includesMembership: program.includes_membership, startsAt: cohort.starts_at, expiresAt: cohort.expires_at }];
    });
  }

  async allEnrollmentCohorts() {
    const rows = await fetchAllRows<EndEmbedRow>(
      (from, to) =>
        this.db.from("member_program_enrollments").select("member_id, program_cohorts(program_id, expires_at)").order("id").range(from, to) as unknown as PromiseLike<{
          data: EndEmbedRow[] | null;
          error: { message: string } | null;
        }>
    );
    return rows.flatMap((row) => {
      const cohort = one(row.program_cohorts);
      return cohort ? [{ memberId: row.member_id, programId: cohort.program_id, expiresAt: cohort.expires_at }] : [];
    });
  }

  async membershipArrivals(sinceDate: string, today: string) {
    const rows = await fetchAllRows<ArrivalEmbedRow>(
      (from, to) =>
        this.db
          .from("member_program_enrollments")
          .select("program_cohorts!inner(starts_at, programs!inner(name, includes_membership)), members(id, name, display_name, email, staff_role)")
          .gte("program_cohorts.starts_at", sinceDate)
          .lte("program_cohorts.starts_at", today)
          .eq("program_cohorts.programs.includes_membership", true)
          .order("id")
          .range(from, to) as unknown as PromiseLike<{ data: ArrivalEmbedRow[] | null; error: { message: string } | null }>
    );
    return rows.map((row) => ({ startsOn: row.program_cohorts.starts_at, programName: one(row.program_cohorts.programs)?.name ?? null, member: one(row.members) }));
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryProgramRepository implements ProgramRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private memberOf(id: string) {
    const m = this.data.members.find((x) => x.id === id);
    return m ? { id: m.id, name: m.name, display_name: m.displayName ?? null, email: m.email ?? "", status: m.status ?? "active", staff_role: m.staffRole ?? null } : null;
  }

  private now() {
    return new Date().toISOString();
  }

  async names() {
    return [...this.data.programs].sort(byKey((p) => p.name, (p) => p.id)).map(({ id, name }) => ({ id, name }));
  }

  async listWithCounts() {
    return [...this.data.programs].sort(byKey((p) => p.name, (p) => p.id)).map((p) => {
      const cohorts = this.data.programCohorts.filter((c) => c.program_id === p.id);
      return { ...p, cohort_count: cohorts.length, enrollment_count: this.data.programEnrollments.filter((e) => cohorts.some((c) => c.id === e.cohort_id)).length };
    });
  }

  async byId(id: string) {
    const program = this.data.programs.find((p) => p.id === id);
    return program ? { ...program } : null;
  }

  async idBySlug(slug: string) {
    return this.data.programs.find((p) => p.slug === slug)?.id ?? null;
  }

  async create(program: NewProgram) {
    if (this.data.programs.some((p) => p.slug === program.slug || p.name === program.name)) throw new Error("duplicate key value violates unique constraint");
    const row: Program = {
      id: crypto.randomUUID(),
      created_at: this.now(),
      updated_at: this.now(),
      description: null,
      includes_membership: true,
      kajabi_offer_names: [],
      ...program,
    };
    this.data.programs.push(row);
    return { ...row };
  }

  async update(id: string, patch: ProgramPatch) {
    const row = this.data.programs.find((p) => p.id === id);
    if (!row) throw new Error("JSON object requested, multiple (or no) rows returned");
    Object.assign(row, patch, { updated_at: this.now() });
    return { ...row };
  }

  async delete(id: string) {
    const cohortIds = new Set(this.data.programCohorts.filter((c) => c.program_id === id).map((c) => c.id));
    this.data.programs = this.data.programs.filter((p) => p.id !== id);
    this.data.programCohorts = this.data.programCohorts.filter((c) => !cohortIds.has(c.id));
    this.data.programEnrollments = this.data.programEnrollments.filter((e) => !cohortIds.has(e.cohort_id));
  }

  async cohortsWithEnrollments(programId: string) {
    return this.data.programCohorts
      .filter((c) => c.program_id === programId)
      .sort(byKey((c) => c.starts_at, (c) => c.id, true))
      .map((c) => ({
        ...c,
        member_program_enrollments: this.data.programEnrollments
          .filter((e) => e.cohort_id === c.id)
          .sort(byKey((e) => e.created_at, (e) => e.id))
          .map((e) => {
            const m = this.memberOf(e.member_id);
            return { id: e.id, notes: e.notes, created_at: e.created_at, member: m && { id: m.id, name: m.name, display_name: m.display_name, email: m.email, status: m.status } };
          }),
      }));
  }

  async cohortForMatching(cohortId: string) {
    const c = this.data.programCohorts.find((x) => x.id === cohortId);
    if (!c) return null;
    const program = this.data.programs.find((p) => p.id === c.program_id);
    return { id: c.id, starts_at: c.starts_at, expires_at: c.expires_at, program: program ? { id: program.id, kajabi_offer_names: [...program.kajabi_offer_names] } : null };
  }

  async createCohort(cohort: NewProgramCohort) {
    if (!this.data.programs.some((p) => p.id === cohort.program_id)) throw new Error("violates foreign key constraint on program_id");
    if (cohort.expires_at < cohort.starts_at) throw new Error("violates check constraint");
    const row: ProgramCohort = { id: crypto.randomUUID(), created_at: this.now(), updated_at: this.now(), created_by: null, notes: null, ...cohort };
    this.data.programCohorts.push(row);
    return { ...row };
  }

  async updateCohort(id: string, patch: ProgramCohortPatch) {
    const row = this.data.programCohorts.find((c) => c.id === id);
    if (!row) throw new Error("JSON object requested, multiple (or no) rows returned");
    Object.assign(row, patch, { updated_at: this.now() });
    return { ...row };
  }

  async deleteCohort(id: string) {
    this.data.programCohorts = this.data.programCohorts.filter((c) => c.id !== id);
    this.data.programEnrollments = this.data.programEnrollments.filter((e) => e.cohort_id !== id);
  }

  async enrolledElsewhere(programId: string, exceptCohortId: string, memberIds: string[]) {
    const result = new Map<string, string>();
    const others = new Map(this.data.programCohorts.filter((c) => c.program_id === programId && c.id !== exceptCohortId).map((c) => [c.id, c.name]));
    const wanted = new Set(memberIds);
    for (const e of [...this.data.programEnrollments].sort(byKey((x) => x.created_at, (x) => x.id))) {
      if (wanted.has(e.member_id) && others.has(e.cohort_id) && !result.has(e.member_id)) result.set(e.member_id, others.get(e.cohort_id)!);
    }
    return result;
  }

  async enroll(enrollment: NewProgramEnrollment) {
    if (this.data.programEnrollments.some((e) => e.member_id === enrollment.member_id && e.cohort_id === enrollment.cohort_id)) throw new ProgramEnrollmentExistsError();
    if (!this.data.programCohorts.some((c) => c.id === enrollment.cohort_id)) throw new Error("violates foreign key constraint on cohort_id");
    const member = this.memberOf(enrollment.member_id);
    if (!member) throw new Error("violates foreign key constraint on member_id");
    const row: ProgramEnrollment = { id: crypto.randomUUID(), created_at: this.now(), updated_at: this.now(), created_by: null, notes: null, ...enrollment };
    this.data.programEnrollments.push(row);
    return { ...row, member: { id: member.id, name: member.name, email: member.email } };
  }

  async unenroll(id: string) {
    this.data.programEnrollments = this.data.programEnrollments.filter((e) => e.id !== id);
  }

  async memberIdsInCohort(cohortId: string) {
    return new Set(this.data.programEnrollments.filter((e) => e.cohort_id === cohortId).map((e) => e.member_id));
  }

  async moveEnrollments(fromMemberId: string, toMemberId: string) {
    const targetCohorts = new Set(this.data.programEnrollments.filter((e) => e.member_id === toMemberId).map((e) => e.cohort_id));
    this.data.programEnrollments = this.data.programEnrollments.filter((e) => !(e.member_id === fromMemberId && targetCohorts.has(e.cohort_id)));
    for (const e of this.data.programEnrollments) if (e.member_id === fromMemberId) e.member_id = toMemberId;
  }

  async enrollmentsOf(memberId: string) {
    return this.data.programEnrollments
      .filter((e) => e.member_id === memberId)
      .sort(byKey((e) => e.created_at, (e) => e.id, true))
      .flatMap((e) => {
        const cohort = this.data.programCohorts.find((c) => c.id === e.cohort_id);
        const program = cohort && this.data.programs.find((p) => p.id === cohort.program_id);
        if (!cohort || !program) return [];
        return [{ id: e.id, createdAt: e.created_at, cohortId: cohort.id, programId: program.id, programName: program.name, includesMembership: program.includes_membership, startsAt: cohort.starts_at, expiresAt: cohort.expires_at }];
      });
  }

  async allEnrollmentCohorts() {
    return [...this.data.programEnrollments].sort(byKey((e) => e.id, (e) => e.id)).flatMap((e) => {
      const cohort = this.data.programCohorts.find((c) => c.id === e.cohort_id);
      return cohort ? [{ memberId: e.member_id, programId: cohort.program_id, expiresAt: cohort.expires_at }] : [];
    });
  }

  async membershipArrivals(sinceDate: string, today: string) {
    return [...this.data.programEnrollments].sort(byKey((e) => e.id, (e) => e.id)).flatMap((e) => {
      const cohort = this.data.programCohorts.find((c) => c.id === e.cohort_id);
      const program = cohort && this.data.programs.find((p) => p.id === cohort.program_id);
      if (!cohort || !program?.includes_membership || cohort.starts_at < sinceDate || cohort.starts_at > today) return [];
      const m = this.memberOf(e.member_id);
      return [{ startsOn: cohort.starts_at, programName: program.name, member: m && { id: m.id, name: m.name, display_name: m.display_name, email: m.email, staff_role: m.staff_role } }];
    });
  }
}
