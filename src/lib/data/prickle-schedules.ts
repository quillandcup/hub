import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import { ORG_TIMEZONE } from "@/lib/config";
import type { Db, Insert, Row, Update } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** A stored hosting schedule (a host's recurring or one-off slot for a month). */
export type ScheduleRow = Omit<Row<"prickle_schedules">, "schedule_host">;

/** Whether a month's hosting schedule is locked against changes by hosts (`prickle_schedule_locks`; a month with no row follows the default rule). */
export type ScheduleLockRow = Row<"prickle_schedule_locks">;

/** A schedule with the name of its prickle type, for a host's own list. */
export type ScheduleWithTypeName = ScheduleRow & { typeName: string | null };

/** A schedule as the admin screens and API return it, with its host and type joined in. */
export type ScheduleDetail = ScheduleRow & {
  member: { id: string; name: string; display_name: string | null; email: string | null } | null;
  prickle_type: { id: string; name: string } | null;
};

/** A proposed or confirmed schedule of a month with the names the hosting calendar labels it by. */
export type ScheduleSlot = Pick<
  ScheduleRow,
  "id" | "recurrence_type" | "day_of_week" | "recurrence_anchor_date" | "week_of_month" | "event_date" | "start_time_local" | "timezone" | "status"
> & {
  typeName: string | null;
  host: { name: string; display_name: string | null } | null;
};

const ID_CHUNK = 100;

/** Embeds the admin screens read with every schedule row. */
const DETAIL_SELECT = `
  *,
  member:members(id, name, display_name, email),
  prickle_type:prickle_types(id, name)
`;

/**
 * Hosting schedules: the slots hosts ask for (or admins assign) per month. Soft-deleted rows
 * (`deleted_at`) are never returned except where a method says so. Methods throw on a database
 * error rather than reading as "no schedules".
 */
export interface PrickleScheduleRepository {
  /** The host's live schedules in these months with their type names, by month then creation. */
  ofHostInMonths(hostId: string, months: string[]): Promise<ScheduleWithTypeName[]>;
  /** The latest month the host has a live schedule in, or null. */
  latestMonthOf(hostId: string): Promise<string | null>;
  /** How many confirmed live schedules the host has. */
  confirmedCountOf(hostId: string): Promise<number>;
  /** The month's proposed and confirmed live schedules, with type and host names. */
  slotsOfMonth(month: string): Promise<ScheduleSlot[]>;
  /** Every live schedule of the month (any status), by creation. */
  liveInMonth(month: string): Promise<ScheduleRow[]>;
  /** The month's live schedules with host and type joined in, by creation (the admin list). */
  detailsOfMonth(month: string): Promise<ScheduleDetail[]>;
  /** One live schedule's id, host and month, or null. */
  liveById(id: string): Promise<Pick<ScheduleRow, "id" | "host_id" | "month"> | null>;
  /** Adds schedules (all or nothing). */
  insert(rows: Insert<"prickle_schedules">[]): Promise<void>;
  /** Adds one schedule and returns it with host and type joined in. */
  insertDetailed(row: Insert<"prickle_schedules">): Promise<ScheduleDetail>;
  /** Updates a schedule by id, only if it is the host's when `hostId` is given (soft delete is an update of `deleted_at`). */
  update(id: string, patch: Update<"prickle_schedules">, scope?: { hostId?: string }): Promise<void>;
  /** Updates a live schedule and returns it joined, or null when there is no live one with that id. */
  updateLive(id: string, patch: Update<"prickle_schedules">): Promise<ScheduleDetail | null>;
  /** Confirms the proposed ones among these schedules; rows in any other status are left alone. */
  confirmProposed(ids: string[], by: { confirmedBy: string | null; at: string }): Promise<void>;
  /** Hands every schedule of one host to another (a member merge): they would cascade away with the old host. */
  reassignHost(fromHostId: string, toHostId: string): Promise<void>;
  /** The prickle types the host has live proposed or confirmed schedules for in this month (`YYYY-MM-DD`, the first) or later: id and name, each type once. */
  scheduledTypesOf(hostId: string, fromMonth: string): Promise<{ typeId: string; typeName: string }[]>;

  // --- month locks ---
  /** The lock rows of these months (months with no row are absent). */
  locksOf(months: string[]): Promise<Pick<ScheduleLockRow, "month" | "locked">[]>;
  /** Every month's lock row, by month. */
  allLocks(): Promise<ScheduleLockRow[]>;
  /** Locks or unlocks a month (creating its row), stamped now, and returns the row. */
  setLock(input: { month: string; locked: boolean; notes: string | null; lockedBy: string | null }): Promise<ScheduleLockRow>;
}


export class SupabasePrickleScheduleRepository implements PrickleScheduleRepository {
  constructor(private readonly db: Db) {}

  async ofHostInMonths(hostId: string, months: string[]): Promise<ScheduleWithTypeName[]> {
    const { data, error } = await this.db
      .from("prickle_schedules")
      .select("*, prickle_types(name)")
      .eq("host_id", hostId)
      .in("month", months)
      .is("deleted_at", null)
      .order("month")
      .order("created_at")
      .order("id");
    if (error) throw new Error(error.message);
    return (data ?? []).map(({ prickle_types, ...row }) => ({
      ...row,
      typeName: prickle_types?.name ?? null,
    }));
  }

  async latestMonthOf(hostId: string) {
    const { data, error } = await this.db
      .from("prickle_schedules")
      .select("month")
      .eq("host_id", hostId)
      .is("deleted_at", null)
      .order("month", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.month ?? null;
  }

  async confirmedCountOf(hostId: string) {
    const { count, error } = await this.db
      .from("prickle_schedules")
      .select("id", { count: "exact", head: true })
      .eq("host_id", hostId)
      .eq("status", "confirmed")
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async slotsOfMonth(month: string): Promise<ScheduleSlot[]> {
    type Raw = Omit<ScheduleSlot, "typeName" | "host"> & { prickle_types: { name: string } | null; member: ScheduleSlot["host"] };
    const rows = await fetchAllRows<Raw>(
      (from, to) =>
        this.db
          .from("prickle_schedules")
          .select(
            "id, recurrence_type, day_of_week, recurrence_anchor_date, week_of_month, event_date, start_time_local, timezone, status, prickle_types(name), member:schedule_host(name, display_name)"
          )
          .eq("month", month)
          .in("status", ["proposed", "confirmed"])
          .is("deleted_at", null)
          .order("id")
          .range(from, to)
    );
    return rows.map(({ prickle_types, member, ...slot }) => ({ ...slot, typeName: prickle_types?.name ?? null, host: member }));
  }

  async liveInMonth(month: string): Promise<ScheduleRow[]> {
    return fetchAllRows<ScheduleRow>(
      (from, to) =>
        this.db.from("prickle_schedules").select("*").eq("month", month).is("deleted_at", null).order("created_at").order("id").range(from, to)
    );
  }

  async detailsOfMonth(month: string): Promise<ScheduleDetail[]> {
    return fetchAllRows<ScheduleDetail>(
      (from, to) =>
        this.db
          .from("prickle_schedules")
          .select(DETAIL_SELECT)
          .eq("month", month)
          .is("deleted_at", null)
          .order("created_at")
          .order("id")
          .range(from, to)
    );
  }

  async liveById(id: string) {
    const { data, error } = await this.db.from("prickle_schedules").select("id, host_id, month").eq("id", id).is("deleted_at", null).maybeSingle();
    if (error) throw new Error(error.message);
    return data ?? null;
  }

  async insert(rows: Insert<"prickle_schedules">[]) {
    if (rows.length === 0) return;
    const { error } = await this.db.from("prickle_schedules").insert(rows);
    if (error) throw new Error(error.message);
  }

  async insertDetailed(row: Insert<"prickle_schedules">) {
    const { data, error } = await this.db.from("prickle_schedules").insert(row).select(DETAIL_SELECT).single();
    if (error) throw new Error(error.message);
    return data;
  }

  async update(id: string, patch: Update<"prickle_schedules">, scope: { hostId?: string } = {}) {
    let query = this.db.from("prickle_schedules").update(patch).eq("id", id);
    if (scope.hostId !== undefined) query = query.eq("host_id", scope.hostId);
    const { error } = await query;
    if (error) throw new Error(error.message);
  }

  async updateLive(id: string, patch: Update<"prickle_schedules">) {
    const { data, error } = await this.db.from("prickle_schedules").update(patch).eq("id", id).is("deleted_at", null).select(DETAIL_SELECT).maybeSingle();
    if (error) throw new Error(error.message);
    return (data) ?? null;
  }

  async confirmProposed(ids: string[], { confirmedBy, at }: { confirmedBy: string | null; at: string }) {
    for (const part of chunk(ids, ID_CHUNK)) {
      const { error } = await this.db
        .from("prickle_schedules")
        .update({ status: "confirmed", confirmed_by: confirmedBy, confirmed_at: at, updated_by: confirmedBy, updated_at: at })
        .in("id", part)
        .eq("status", "proposed");
      if (error) throw new Error(error.message);
    }
  }

  async reassignHost(fromHostId: string, toHostId: string) {
    const { error } = await this.db.from("prickle_schedules").update({ host_id: toHostId }).eq("host_id", fromHostId);
    if (error) throw new Error(error.message);
  }

  async scheduledTypesOf(hostId: string, fromMonth: string) {
    type Raw = { type_id: string; prickle_types: { id: string; name: string } | { id: string; name: string }[] | null };
    const rows = await fetchAllRows<Raw>(
      (from, to) =>
        this.db
          .from("prickle_schedules")
          .select("type_id, prickle_types!inner(id, name)")
          .eq("host_id", hostId)
          .gte("month", fromMonth)
          .in("status", ["proposed", "confirmed"])
          .is("deleted_at", null)
          .order("id")
          .range(from, to)
    );
    const types = new Map<string, string>();
    for (const row of rows) {
      const type = Array.isArray(row.prickle_types) ? row.prickle_types[0] : row.prickle_types;
      if (row.type_id && type) types.set(row.type_id, type.name);
    }
    return [...types].map(([typeId, typeName]) => ({ typeId, typeName }));
  }

  async locksOf(months: string[]) {
    const { data, error } = await this.db.from("prickle_schedule_locks").select("month, locked").in("month", months);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async allLocks() {
    const { data, error } = await this.db.from("prickle_schedule_locks").select("*").order("month");
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async setLock({ month, locked, notes, lockedBy }: { month: string; locked: boolean; notes: string | null; lockedBy: string | null }) {
    const { data, error } = await this.db
      .from("prickle_schedule_locks")
      .upsert({ month, locked, notes, locked_by: lockedBy, locked_at: new Date().toISOString() }, { onConflict: "month" })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data;
  }
}

/** In-memory twin over an `InMemoryDataset`; ids and creation times are made up like the database's defaults. */
export class InMemoryPrickleScheduleRepository implements PrickleScheduleRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private live() {
    return this.data.prickleSchedules.filter((s) => s.deleted_at === null);
  }

  private byCreation(rows: ScheduleRow[]) {
    return [...rows].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
  }

  private typeName(typeId: string) {
    return this.data.prickleTypes.find((t) => t.id === typeId)?.name ?? null;
  }

  private detail(row: ScheduleRow): ScheduleDetail {
    const member = this.data.members.find((m) => m.id === row.host_id);
    const type = this.data.prickleTypes.find((t) => t.id === row.type_id);
    return {
      ...row,
      member: member ? { id: member.id, name: member.name, display_name: member.displayName ?? null, email: member.email ?? null } : null,
      prickle_type: type ? { id: type.id, name: type.name } : null,
    };
  }

  async ofHostInMonths(hostId: string, months: string[]) {
    return this.byCreation(this.live().filter((s) => s.host_id === hostId && months.includes(s.month)))
      .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
      .map((row) => ({ ...row, typeName: this.typeName(row.type_id) }));
  }

  async latestMonthOf(hostId: string) {
    const months = this.live().filter((s) => s.host_id === hostId).map((s) => s.month).sort();
    return months.at(-1) ?? null;
  }

  async confirmedCountOf(hostId: string) {
    return this.live().filter((s) => s.host_id === hostId && s.status === "confirmed").length;
  }

  async slotsOfMonth(month: string) {
    return this.live()
      .filter((s) => s.month === month && (s.status === "proposed" || s.status === "confirmed"))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((s) => {
        const member = this.data.members.find((m) => m.id === s.host_id);
        return {
          id: s.id,
          recurrence_type: s.recurrence_type,
          day_of_week: s.day_of_week,
          recurrence_anchor_date: s.recurrence_anchor_date,
          week_of_month: s.week_of_month,
          event_date: s.event_date,
          start_time_local: s.start_time_local,
          timezone: s.timezone,
          status: s.status,
          typeName: this.typeName(s.type_id),
          host: member ? { name: member.name, display_name: member.displayName ?? null } : null,
        };
      });
  }

  async liveInMonth(month: string) {
    return this.byCreation(this.live().filter((s) => s.month === month)).map((s) => ({ ...s }));
  }

  async detailsOfMonth(month: string) {
    return this.byCreation(this.live().filter((s) => s.month === month)).map((s) => this.detail(s));
  }

  async liveById(id: string) {
    const row = this.live().find((s) => s.id === id);
    return row ? { id: row.id, host_id: row.host_id, month: row.month } : null;
  }

  async insert(rows: Insert<"prickle_schedules">[]) {
    rows.forEach((row) => this.check(row)); // all or nothing
    for (const row of rows) this.add(row);
  }

  async insertDetailed(row: Insert<"prickle_schedules">) {
    this.check(row);
    return this.detail(this.add(row));
  }

  async update(id: string, patch: Update<"prickle_schedules">, scope: { hostId?: string } = {}) {
    this.check(patch);
    const row = this.data.prickleSchedules.find((s) => s.id === id && (scope.hostId === undefined || s.host_id === scope.hostId));
    if (row) Object.assign(row, patch);
  }

  async updateLive(id: string, patch: Update<"prickle_schedules">) {
    this.check(patch);
    const row = this.live().find((s) => s.id === id);
    if (!row) return null;
    Object.assign(row, patch);
    return this.detail(row);
  }

  /** The database's own rules: a status from the list, and a host and type that exist. */
  private check(row: Partial<Insert<"prickle_schedules">>) {
    if (row.status !== undefined && !["proposed", "confirmed", "declined"].includes(row.status)) throw new Error("violates check constraint on status");
    if (row.host_id !== undefined && !this.data.members.some((m) => m.id === row.host_id)) throw new Error("violates foreign key constraint on host_id");
    if (row.type_id !== undefined && !this.data.prickleTypes.some((t) => t.id === row.type_id)) throw new Error("violates foreign key constraint on type_id");
  }

  async confirmProposed(ids: string[], { confirmedBy, at }: { confirmedBy: string | null; at: string }) {
    const wanted = new Set(ids);
    for (const row of this.data.prickleSchedules) {
      if (wanted.has(row.id) && row.status === "proposed") {
        Object.assign(row, { status: "confirmed", confirmed_by: confirmedBy, confirmed_at: at, updated_by: confirmedBy, updated_at: at });
      }
    }
  }

  async reassignHost(fromHostId: string, toHostId: string) {
    for (const row of this.data.prickleSchedules) if (row.host_id === fromHostId) row.host_id = toHostId;
  }

  async scheduledTypesOf(hostId: string, fromMonth: string) {
    const types = new Map<string, string>();
    for (const row of this.live()) {
      if (row.host_id !== hostId || row.month < fromMonth || !["proposed", "confirmed"].includes(row.status)) continue;
      const name = this.typeName(row.type_id);
      if (name !== null) types.set(row.type_id, name);
    }
    return [...types].map(([typeId, typeName]) => ({ typeId, typeName }));
  }

  async locksOf(months: string[]) {
    return this.data.scheduleLocks.filter((l) => months.includes(l.month)).map(({ month, locked }) => ({ month, locked }));
  }

  async allLocks() {
    return [...this.data.scheduleLocks].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0)).map((l) => ({ ...l }));
  }

  async setLock({ month, locked, notes, lockedBy }: { month: string; locked: boolean; notes: string | null; lockedBy: string | null }) {
    const row: ScheduleLockRow = { month, locked, notes, locked_by: lockedBy, locked_at: new Date().toISOString() };
    const at = this.data.scheduleLocks.findIndex((l) => l.month === month);
    if (at >= 0) this.data.scheduleLocks[at] = row;
    else this.data.scheduleLocks.push(row);
    return { ...row };
  }

  /** Adds a row with the database's defaults; creation times rise strictly so "by creation" never ties. */
  private add(row: Insert<"prickle_schedules">): ScheduleRow {
    const latest = Math.max(0, ...this.data.prickleSchedules.map((s) => Date.parse(s.created_at)));
    const now = new Date(Math.max(Date.now(), latest + 1)).toISOString();
    const stored: ScheduleRow = {
      id: row.id ?? `psch_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      host_id: row.host_id,
      type_id: row.type_id,
      month: row.month,
      recurrence_type: row.recurrence_type,
      day_of_week: row.day_of_week ?? null,
      recurrence_anchor_date: row.recurrence_anchor_date ?? null,
      week_of_month: row.week_of_month ?? null,
      event_date: row.event_date ?? null,
      start_time_local: row.start_time_local,
      timezone: row.timezone ?? ORG_TIMEZONE,
      status: row.status ?? "proposed",
      notes: row.notes ?? null,
      carried_forward_from: row.carried_forward_from ?? null,
      confirmed_by: row.confirmed_by ?? null,
      confirmed_at: row.confirmed_at ?? null,
      created_at: row.created_at ?? now,
      updated_at: row.updated_at ?? now,
      updated_by: row.updated_by ?? null,
      deleted_at: row.deleted_at ?? null,
      deleted_by: row.deleted_by ?? null,
    };
    this.data.prickleSchedules.push(stored);
    return stored;
  }
}
