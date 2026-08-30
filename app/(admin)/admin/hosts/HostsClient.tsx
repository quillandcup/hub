"use client";

import { useEffect, useState } from "react";
import {
  DAY_NAMES,
  formatScheduleLabel,
  getMonthStart,
  getNextMonthStart,
  type RecurrenceType,
  type ScheduleStatus,
} from "@/lib/prickle-schedules";

interface Member {
  id: string;
  name: string;
  email: string;
}

interface Schedule {
  id: string;
  host_id: string;
  type_id: string;
  month: string;
  recurrence_type: RecurrenceType;
  day_of_week: number | null;
  recurrence_anchor_date: string | null;
  week_of_month: number | null;
  event_date: string | null;
  start_time_local: string;
  timezone: string;
  status: ScheduleStatus;
  notes: string | null;
  carried_forward_from: string | null;
  member: Member;
  prickle_type: { id: string; name: string };
}

interface PrickleType {
  id: string;
  name: string;
}

const now = new Date();
const CURRENT_MONTH = getMonthStart(now).toISOString().slice(0, 10);
const NEXT_MONTH = getNextMonthStart(now).toISOString().slice(0, 10);

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}T00:00:00Z`)
  );
}

const STATUS_STYLES: Record<ScheduleStatus, string> = {
  proposed: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300",
  confirmed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300",
  declined: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
};

const EMPTY_NEW_FORM = {
  hostEmail: "",
  typeId: "",
  recurrenceType: "weekly" as RecurrenceType,
  dayOfWeek: 1,
  weekOfMonth: 1,
  firstDate: "",
  eventDate: "",
  startTimeLocal: "19:00",
  notes: "",
  confirmImmediately: false,
};

export default function HostsClient({ prickleTypes }: { prickleTypes: PrickleType[] }) {
  const [tab, setTab] = useState<"current" | "next">("current");
  const [schedules, setSchedules] = useState<Record<string, Schedule[]>>({});
  const [locked, setLocked] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_NEW_FORM);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const month = tab === "current" ? CURRENT_MONTH : NEXT_MONTH;

  async function fetchAll() {
    try {
      setLoading(true);
      const [scheduleRes, lockRes] = await Promise.all([
        fetch(`/api/prickle-schedules?month=${month}`),
        fetch("/api/prickle-schedule-locks"),
      ]);
      const scheduleData = await scheduleRes.json();
      const lockData = await lockRes.json();

      if (!scheduleRes.ok) throw new Error(scheduleData.error || "Failed to fetch schedules");

      setSchedules((prev) => ({ ...prev, [month]: scheduleData.schedules }));

      const lockOverride = (lockData.locks ?? []).find((l: { month: string }) => l.month.slice(0, 10) === month);
      const effectiveLocked = lockOverride
        ? lockOverride.locked
        : new Date(`${month}T00:00:00Z`).getTime() <= getMonthStart(new Date()).getTime();
      setLocked((prev) => ({ ...prev, [month]: effectiveLocked }));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function handleConfirm(id: string) {
    setError(null);
    const res = await fetch(`/api/prickle-schedules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "confirmed" }),
    });
    if (!res.ok) {
      const body = await res.json();
      setError(body.error || "Failed to confirm");
      return;
    }
    fetchAll();
  }

  async function handleDecline(id: string) {
    setError(null);
    const res = await fetch(`/api/prickle-schedules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "declined" }),
    });
    if (!res.ok) {
      const body = await res.json();
      setError(body.error || "Failed to decline");
      return;
    }
    fetchAll();
  }

  async function handleRemove(id: string) {
    if (!confirm("Remove this schedule?")) return;
    setError(null);
    const res = await fetch(`/api/prickle-schedules/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json();
      setError(body.error || "Failed to remove");
      return;
    }
    fetchAll();
  }

  async function handleBootstrap() {
    setError(null);
    setMessage(null);
    setBootstrapping(true);
    try {
      const res = await fetch("/api/prickle-schedules/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: CURRENT_MONTH }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to bootstrap from calendar");
      setMessage(
        `Bootstrapped ${body.created} schedule${body.created === 1 ? "" : "s"} from the calendar` +
          (body.skippedExisting ? `, skipped ${body.skippedExisting} already there` : "") +
          (body.copiedToNextMonth ? `, copied ${body.copiedToNextMonth} to next month` : "") +
          "."
      );
      fetchAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBootstrapping(false);
    }
  }

  async function handleToggleLock() {
    setError(null);
    const res = await fetch("/api/prickle-schedule-locks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, locked: !locked[month] }),
    });
    if (!res.ok) {
      const body = await res.json();
      setError(body.error || "Failed to update lock");
      return;
    }
    fetchAll();
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    try {
      const membersRes = await fetch(`/api/members?email=${encodeURIComponent(form.hostEmail)}`);
      const membersData = await membersRes.json();
      if (!membersRes.ok || !membersData.members?.length) {
        throw new Error("Member not found with that email address");
      }
      const hostId = membersData.members[0].id;

      const payload: Record<string, unknown> = {
        host_id: hostId,
        type_id: form.typeId,
        month,
        recurrence_type: form.recurrenceType,
        start_time_local: form.startTimeLocal,
        notes: form.notes || null,
        status: form.confirmImmediately ? "confirmed" : "proposed",
      };
      if (form.recurrenceType === "weekly") {
        payload.day_of_week = form.dayOfWeek;
      } else if (form.recurrenceType === "biweekly") {
        if (!form.firstDate) throw new Error("Pick the first date");
        payload.day_of_week = new Date(`${form.firstDate}T00:00:00Z`).getUTCDay();
        payload.recurrence_anchor_date = form.firstDate;
      } else if (form.recurrenceType === "monthly") {
        payload.day_of_week = form.dayOfWeek;
        payload.week_of_month = form.weekOfMonth;
      } else if (form.recurrenceType === "one_off") {
        if (!form.eventDate) throw new Error("Pick the event date");
        payload.event_date = form.eventDate;
      }

      const res = await fetch("/api/prickle-schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create schedule");

      setForm(EMPTY_NEW_FORM);
      setShowForm(false);
      fetchAll();
    } catch (err: any) {
      setError(err.message);
    }
  }

  const monthSchedules = schedules[month] ?? [];

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2 dark:text-slate-100">Hosts</h1>
        <p className="text-gray-600 dark:text-slate-400">
          Review and confirm who&apos;s hosting which prickle, month by month.
        </p>
      </div>

      <div className="flex items-center gap-4 mb-6 border-b border-gray-200 dark:border-slate-800">
        <button
          onClick={() => setTab("current")}
          className={`pb-2 px-1 border-b-2 font-medium text-sm ${
            tab === "current"
              ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
              : "border-transparent text-gray-500 dark:text-slate-400"
          }`}
        >
          Current Month ({monthLabel(CURRENT_MONTH)})
        </button>
        <button
          onClick={() => setTab("next")}
          className={`pb-2 px-1 border-b-2 font-medium text-sm ${
            tab === "next"
              ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
              : "border-transparent text-gray-500 dark:text-slate-400"
          }`}
        >
          Next Month ({monthLabel(NEXT_MONTH)})
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded">
          <p className="text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      {message && (
        <div className="mb-4 p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded">
          <p className="text-emerald-800 dark:text-emerald-300">{message}</p>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Add Schedule
            </button>
          )}
          {tab === "current" && (
            <button
              onClick={handleBootstrap}
              disabled={bootstrapping}
              className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
              title="Create confirmed schedules from who's already hosting on the calendar this month, then copy them to next month"
            >
              {bootstrapping ? "Bootstrapping…" : "Bootstrap from calendar"}
            </button>
          )}
        </div>
        <button
          onClick={handleToggleLock}
          className={`px-3 py-1.5 rounded text-sm font-medium border ${
            locked[month]
              ? "bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
              : "bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
          }`}
        >
          {locked[month] ? "🔓 Unlock month" : "🔒 Lock month"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 p-6 border border-gray-200 dark:border-slate-700 rounded bg-gray-50 dark:bg-slate-800/50 space-y-4">
          <h2 className="text-lg font-semibold dark:text-slate-100">Add Schedule for {monthLabel(month)}</h2>

          <div>
            <label className="block text-sm font-medium mb-1 dark:text-slate-300">Host Email</label>
            <input
              type="email"
              value={form.hostEmail}
              onChange={(e) => setForm({ ...form, hostEmail: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 dark:text-slate-300">Prickle Type</label>
            <select
              value={form.typeId}
              onChange={(e) => setForm({ ...form, typeId: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded"
              required
            >
              <option value="">Select a type…</option>
              {prickleTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 dark:text-slate-300">How often</label>
            <select
              value={form.recurrenceType}
              onChange={(e) => setForm({ ...form, recurrenceType: e.target.value as RecurrenceType })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded"
            >
              <option value="weekly">Every week</option>
              <option value="biweekly">Every other week</option>
              <option value="monthly">Once a month</option>
              <option value="one_off">Just once</option>
            </select>
          </div>

          {form.recurrenceType === "weekly" && (
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-slate-300">Day</label>
              <select
                value={form.dayOfWeek}
                onChange={(e) => setForm({ ...form, dayOfWeek: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded"
              >
                {DAY_NAMES.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          )}

          {form.recurrenceType === "biweekly" && (
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-slate-300">First date</label>
              <input
                type="date"
                value={form.firstDate}
                onChange={(e) => setForm({ ...form, firstDate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded"
                required
              />
            </div>
          )}

          {form.recurrenceType === "monthly" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-slate-300">Week</label>
                <select
                  value={form.weekOfMonth}
                  onChange={(e) => setForm({ ...form, weekOfMonth: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded"
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-slate-300">Day</label>
                <select
                  value={form.dayOfWeek}
                  onChange={(e) => setForm({ ...form, dayOfWeek: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded"
                >
                  {DAY_NAMES.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {form.recurrenceType === "one_off" && (
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-slate-300">Event date</label>
              <input
                type="date"
                value={form.eventDate}
                onChange={(e) => setForm({ ...form, eventDate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded"
                required
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1 dark:text-slate-300">Start time</label>
            <input
              type="time"
              value={form.startTimeLocal}
              onChange={(e) => setForm({ ...form, startTimeLocal: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 dark:text-slate-300">Notes (optional)</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded"
            />
          </div>

          <label className="flex items-center gap-2 text-sm dark:text-slate-300">
            <input
              type="checkbox"
              checked={form.confirmImmediately}
              onChange={(e) => setForm({ ...form, confirmImmediately: e.target.checked })}
            />
            Confirm immediately
          </label>

          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
              Create
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setForm(EMPTY_NEW_FORM);
              }}
              className="px-4 py-2 bg-gray-300 text-gray-800 rounded hover:bg-gray-400 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="border border-gray-200 dark:border-slate-700 rounded overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-slate-300">Host</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-slate-300">Schedule</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-slate-300">Status</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-slate-300">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-500 dark:text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : monthSchedules.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-500 dark:text-slate-400">
                  No schedules for this month yet.
                </td>
              </tr>
            ) : (
              monthSchedules.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                  <td className="px-4 py-3">
                    <div className="font-medium dark:text-slate-100">{s.member.name}</div>
                    <div className="text-sm text-gray-600 dark:text-slate-400">{s.member.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm dark:text-slate-200">
                      {formatScheduleLabel(s.prickle_type.name, {
                        recurrenceType: s.recurrence_type,
                        dayOfWeek: s.day_of_week,
                        recurrenceAnchorDate: s.recurrence_anchor_date,
                        weekOfMonth: s.week_of_month,
                        eventDate: s.event_date,
                        startTimeLocal: s.start_time_local,
                        timezone: s.timezone,
                      })}
                    </div>
                    {s.carried_forward_from && (
                      <div className="text-xs text-gray-400 dark:text-slate-500">carried forward from last month</div>
                    )}
                    {s.notes && <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">{s.notes}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded ${STATUS_STYLES[s.status]}`}>{s.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 flex-wrap">
                      {s.status !== "confirmed" && (
                        <button onClick={() => handleConfirm(s.id)} className="text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300 text-sm">
                          Confirm
                        </button>
                      )}
                      {s.status !== "declined" && (
                        <button onClick={() => handleDecline(s.id)} className="text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300 text-sm">
                          Decline
                        </button>
                      )}
                      <button onClick={() => handleRemove(s.id)} className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-sm">
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
