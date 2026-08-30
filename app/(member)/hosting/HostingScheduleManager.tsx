"use client";

import { useMemo, useState } from "react";
import {
  DAY_NAMES,
  formatScheduleLabel,
  generateScheduleInstanceDates,
  summarizeMonth,
  type RecurrenceType,
} from "@/lib/prickle-schedules";
import type { SlotClick } from "@/components/CalendarWeekView";
import { requestToHost, updateMySchedule, withdrawMySchedule, type MyScheduleRow } from "./actions";
import HostingCalendarPicker from "./HostingCalendarPicker";

interface PrickleType {
  id: string;
  name: string;
}

interface Props {
  initialSchedules: MyScheduleRow[];
  prickleTypes: PrickleType[];
  currentMonth: string;
  nextMonth: string;
  currentMonthLocked: boolean;
  nextMonthLocked: boolean;
}

const STATUS_STYLES: Record<MyScheduleRow["status"], string> = {
  proposed: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  confirmed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  declined: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}T00:00:00Z`)
  );
}

interface FormState {
  typeId: string;
  recurrenceType: RecurrenceType;
  dayOfWeek: number;
  weekOfMonth: number;
  firstDate: string; // biweekly: derives day_of_week + anchor
  eventDate: string; // one_off
  startTimeLocal: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  typeId: "",
  recurrenceType: "weekly",
  dayOfWeek: 1,
  weekOfMonth: 1,
  firstDate: "",
  eventDate: "",
  startTimeLocal: "19:00",
  notes: "",
};

function ScheduleForm({
  prickleTypes,
  month,
  onCancel,
  onSaved,
}: {
  prickleTypes: PrickleType[];
  month: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickedSlot, setPickedSlot] = useState<SlotClick | null>(null);

  function toIsoDateLocal(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function handleSlotPick(slot: SlotClick) {
    setPickedSlot(slot);
    const startTimeLocal = `${String(slot.hour).padStart(2, "0")}:${String(slot.minute).padStart(2, "0")}`;
    setForm((f) => {
      const next = { ...f, startTimeLocal };
      if (f.recurrenceType === "weekly") {
        next.dayOfWeek = slot.date.getDay();
      } else if (f.recurrenceType === "biweekly") {
        next.firstDate = toIsoDateLocal(slot.date);
      } else if (f.recurrenceType === "monthly") {
        next.dayOfWeek = slot.date.getDay();
        next.weekOfMonth = Math.floor((slot.date.getDate() - 1) / 7) + 1;
      } else if (f.recurrenceType === "one_off") {
        next.eventDate = toIsoDateLocal(slot.date);
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.typeId) {
      setError("Pick a prickle type");
      return;
    }

    let payload: Parameters<typeof requestToHost>[0] = {
      month,
      typeId: form.typeId,
      recurrenceType: form.recurrenceType,
      startTimeLocal: form.startTimeLocal,
      notes: form.notes,
    };

    if (form.recurrenceType === "weekly") {
      payload = { ...payload, dayOfWeek: form.dayOfWeek };
    } else if (form.recurrenceType === "biweekly") {
      if (!form.firstDate) {
        setError("Pick the first date you'll host");
        return;
      }
      const d = new Date(`${form.firstDate}T00:00:00Z`);
      payload = { ...payload, dayOfWeek: d.getUTCDay(), recurrenceAnchorDate: form.firstDate };
    } else if (form.recurrenceType === "monthly") {
      payload = { ...payload, dayOfWeek: form.dayOfWeek, weekOfMonth: form.weekOfMonth };
    } else if (form.recurrenceType === "one_off") {
      if (!form.eventDate) {
        setError("Pick the event date");
        return;
      }
      payload = { ...payload, eventDate: form.eventDate };
    }

    setSaving(true);
    const result = await requestToHost(payload);
    setSaving(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }
    onSaved();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 p-6 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900 space-y-4"
    >
      <h3 className="font-medium text-slate-900 dark:text-slate-100">Request to host for {monthLabel(month)}</h3>

      <HostingCalendarPicker month={month} onPick={handleSlotPick} selectedSlot={pickedSlot} />

      <div>
        <label htmlFor="hosting-type" className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
          Prickle type
        </label>
        <select
          id="hosting-type"
          value={form.typeId}
          onChange={(e) => setForm({ ...form, typeId: e.target.value })}
          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
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
        <label htmlFor="hosting-recurrence" className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
          How often
        </label>
        <select
          id="hosting-recurrence"
          value={form.recurrenceType}
          onChange={(e) => setForm({ ...form, recurrenceType: e.target.value as RecurrenceType })}
          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
        >
          <option value="weekly">Every week</option>
          <option value="biweekly">Every other week</option>
          <option value="monthly">Once a month</option>
          <option value="one_off">Just once</option>
        </select>
      </div>

      {form.recurrenceType === "weekly" && (
        <div>
          <label htmlFor="hosting-day-weekly" className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
            Day
          </label>
          <select
            id="hosting-day-weekly"
            value={form.dayOfWeek}
            onChange={(e) => setForm({ ...form, dayOfWeek: Number(e.target.value) })}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
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
          <label htmlFor="hosting-first-date" className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
            First date you&apos;ll host (repeats every other week from here)
          </label>
          <input
            id="hosting-first-date"
            type="date"
            value={form.firstDate}
            onChange={(e) => setForm({ ...form, firstDate: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            required
          />
        </div>
      )}

      {form.recurrenceType === "monthly" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="hosting-week-monthly" className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
              Week
            </label>
            <select
              id="hosting-week-monthly"
              value={form.weekOfMonth}
              onChange={(e) => setForm({ ...form, weekOfMonth: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            >
              <option value={1}>1st</option>
              <option value={2}>2nd</option>
              <option value={3}>3rd</option>
              <option value={4}>4th</option>
              <option value={5}>5th</option>
            </select>
          </div>
          <div>
            <label htmlFor="hosting-day-monthly" className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
              Day
            </label>
            <select
              id="hosting-day-monthly"
              value={form.dayOfWeek}
              onChange={(e) => setForm({ ...form, dayOfWeek: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
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
          <label htmlFor="hosting-event-date" className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
            Event date
          </label>
          <input
            id="hosting-event-date"
            type="date"
            value={form.eventDate}
            onChange={(e) => setForm({ ...form, eventDate: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            required
          />
        </div>
      )}

      <div>
        <label htmlFor="hosting-start-time" className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
          Start time
        </label>
        <input
          id="hosting-start-time"
          type="time"
          value={form.startTimeLocal}
          onChange={(e) => setForm({ ...form, startTimeLocal: e.target.value })}
          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          required
        />
      </div>

      <div>
        <label htmlFor="hosting-notes" className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
          Notes (optional)
        </label>
        <textarea
          id="hosting-notes"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          rows={2}
          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm"
        />
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {saving ? "Submitting…" : "Submit request"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg text-sm font-medium hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function ScheduleRowActions({
  schedule,
  locked,
  onChanged,
}: {
  schedule: MyScheduleRow;
  locked: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(schedule.notes ?? "");

  async function handleWithdraw() {
    if (!confirm(`Withdraw your ${schedule.typeName} slot?`)) return;
    setBusy(true);
    setError(null);
    const result = await withdrawMySchedule(schedule.id);
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onChanged();
  }

  async function handleSaveNotes() {
    setBusy(true);
    setError(null);
    const result = await updateMySchedule(schedule.id, { notes });
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setEditingNotes(false);
    onChanged();
  }

  if (locked) {
    return <span className="text-xs text-slate-400 dark:text-slate-500">Locked</span>;
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-3 text-sm">
        <button
          type="button"
          onClick={() => setEditingNotes((v) => !v)}
          disabled={busy}
          className="text-blue-600 hover:text-blue-800 dark:text-blue-400"
        >
          {editingNotes ? "Cancel" : "Edit notes"}
        </button>
        <button
          type="button"
          onClick={handleWithdraw}
          disabled={busy}
          className="text-red-600 hover:text-red-800 dark:text-red-400"
        >
          Withdraw
        </button>
      </div>
      {editingNotes && (
        <div className="flex gap-2 items-start">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="flex-1 px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 text-sm"
          />
          <button
            type="button"
            onClick={handleSaveNotes}
            disabled={busy}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
          >
            Save
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function MonthSection({
  label,
  month,
  schedules,
  locked,
  onChanged,
  onRequestSlot,
}: {
  label: string;
  month: string;
  schedules: MyScheduleRow[];
  locked: boolean;
  onChanged: () => void;
  onRequestSlot: () => void;
}) {
  const stats = summarizeMonth(schedules);
  const monthStart = new Date(`${month}T00:00:00Z`);
  const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0));

  const pills = useMemo(() => {
    return schedules.flatMap((s) =>
      generateScheduleInstanceDates(
        {
          recurrenceType: s.recurrenceType,
          dayOfWeek: s.dayOfWeek,
          recurrenceAnchorDate: s.recurrenceAnchorDate,
          weekOfMonth: s.weekOfMonth,
          eventDate: s.eventDate,
          startTimeLocal: s.startTimeLocal,
          timezone: s.timezone,
        },
        monthStart,
        monthEnd
      ).map((date) => ({ date, schedule: s }))
    );
  }, [schedules, month]);

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-medium text-lg text-slate-900 dark:text-slate-100">
          {label} — {monthLabel(month)}
        </h3>
        {locked ? (
          <span className="text-xs px-2 py-1 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
            🔒 Locked
          </span>
        ) : (
          <button
            type="button"
            onClick={onRequestSlot}
            className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 font-medium"
          >
            + Request a slot
          </button>
        )}
      </div>

      {locked && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          This month is locked — changes apply to next month instead.
        </p>
      )}

      {schedules.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No hosting slots this month.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-amber-50 dark:bg-amber-900/10 rounded-lg py-2">
              <div className="text-lg font-semibold text-amber-700 dark:text-amber-400">{stats.proposed}</div>
              <div className="text-xs text-amber-700/70 dark:text-amber-400/70">Proposed</div>
            </div>
            <div className="bg-emerald-50 dark:bg-emerald-900/10 rounded-lg py-2">
              <div className="text-lg font-semibold text-emerald-700 dark:text-emerald-400">{stats.confirmed}</div>
              <div className="text-xs text-emerald-700/70 dark:text-emerald-400/70">Confirmed</div>
            </div>
            <div className="bg-slate-100 dark:bg-slate-800 rounded-lg py-2">
              <div className="text-lg font-semibold text-slate-600 dark:text-slate-400">{stats.declined}</div>
              <div className="text-xs text-slate-500 dark:text-slate-500">Declined</div>
            </div>
          </div>

          {pills.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {pills
                .sort((a, b) => a.date.getTime() - b.date.getTime())
                .map(({ date, schedule }, i) => (
                  <span
                    key={`${schedule.id}-${i}`}
                    title={schedule.typeName}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap ${
                      schedule.status === "confirmed"
                        ? "bg-emerald-50 border-emerald-300 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-700 dark:text-emerald-400"
                        : schedule.status === "declined"
                        ? "bg-slate-100 border-slate-300 text-slate-500 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-500"
                        : "bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-400"
                    }`}
                  >
                    {new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(date)}
                  </span>
                ))}
            </div>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <th className="pb-2 pr-2">Schedule</th>
                <th className="pb-2 pr-2">Status</th>
                <th className="pb-2 pr-2">Notes</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {schedules.map((s) => (
                <tr key={s.id}>
                  <td className="py-2 pr-2 text-slate-900 dark:text-slate-100">
                    {formatScheduleLabel(s.typeName, {
                      recurrenceType: s.recurrenceType,
                      dayOfWeek: s.dayOfWeek,
                      recurrenceAnchorDate: s.recurrenceAnchorDate,
                      weekOfMonth: s.weekOfMonth,
                      eventDate: s.eventDate,
                      startTimeLocal: s.startTimeLocal,
                      timezone: s.timezone,
                    })}
                    {s.carriedForwardFrom && (
                      <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">(carried forward)</span>
                    )}
                  </td>
                  <td className="py-2 pr-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[s.status]}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-slate-600 dark:text-slate-400">{s.notes || "—"}</td>
                  <td className="py-2">
                    <ScheduleRowActions schedule={s} locked={locked} onChanged={onChanged} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export default function HostingScheduleManager({
  initialSchedules,
  prickleTypes,
  currentMonth,
  nextMonth,
  currentMonthLocked,
  nextMonthLocked,
}: Props) {
  const [schedules, setSchedules] = useState(initialSchedules);
  const [requestingForMonth, setRequestingForMonth] = useState<string | null>(null);

  const currentSchedules = schedules.filter((s) => s.month === currentMonth);
  const nextSchedules = schedules.filter((s) => s.month === nextMonth);

  function handleChanged() {
    // Server actions already revalidatePath('/hosting'); a full page refresh
    // picks up fresh server data. Simplest correct approach given this is a
    // client component holding its own copy of server-fetched data.
    window.location.reload();
  }

  if (schedules.length === 0 && !requestingForMonth) {
    return (
      <div className="max-w-xl mx-auto text-center py-12 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg">
        <p className="text-4xl mb-3">🎙️</p>
        <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-2">
          Want to host {monthLabel(nextMonth)}?
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 max-w-sm mx-auto">
          Most hedgies aren&apos;t hosts — but if you&apos;d like to run a prickle next month, request a slot and an
          admin will confirm it.
        </p>
        <button
          type="button"
          onClick={() => setRequestingForMonth(nextMonth)}
          disabled={nextMonthLocked}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-lg text-sm font-medium"
        >
          Request to host
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {requestingForMonth && (
        <ScheduleForm
          prickleTypes={prickleTypes}
          month={requestingForMonth}
          onCancel={() => setRequestingForMonth(null)}
          onSaved={handleChanged}
        />
      )}

      <MonthSection
        label="Current Month"
        month={currentMonth}
        schedules={currentSchedules}
        locked={currentMonthLocked}
        onChanged={handleChanged}
        onRequestSlot={() => setRequestingForMonth(currentMonth)}
      />
      <MonthSection
        label="Next Month"
        month={nextMonth}
        schedules={nextSchedules}
        locked={nextMonthLocked}
        onChanged={handleChanged}
        onRequestSlot={() => setRequestingForMonth(nextMonth)}
      />
    </div>
  );
}
