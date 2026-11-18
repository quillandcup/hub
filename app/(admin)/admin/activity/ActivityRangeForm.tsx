"use client";

import { useState } from "react";
import DatePicker from "@/components/DatePicker";
import { RANGE_FLOOR, type DayRange } from "@/lib/activity-range";
import { orgYmd } from "@/lib/org-week";

/**
 * A custom From/To day range for an activity feed: two date pickers and Apply. The days are Eastern calendar days (the whole To
 * day is included); `onApply` gets them as YYYY-MM-DD and the page puts them in the URL, where the server validates them again.
 */
export default function ActivityRangeForm({ range, onApply }: { range: DayRange | null; onApply: (range: DayRange) => void }) {
  // A range that starts at the floor was "up to <day>": show From empty rather than the floor.
  const [from, setFrom] = useState(range && range.from !== RANGE_FLOOR ? range.from : "");
  const [to, setTo] = useState(range?.to ?? "");
  const today = orgYmd(new Date());
  const backwards = from !== "" && to !== "" && from > to;
  const ready = (from !== "" || to !== "") && !backwards;

  return (
    <form
      aria-label="Custom date range"
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        onApply({ from: from || RANGE_FLOOR, to: to || today });
      }}
    >
      <DatePicker id="activity-range-from" label="From" value={from} onChange={setFrom} max={to || today} />
      <DatePicker id="activity-range-to" label="To" value={to} onChange={setTo} min={from || undefined} max={today} />
      <button
        type="submit"
        disabled={!ready}
        data-track="activity-range-apply"
        className="px-4 py-2 bg-plum-600 hover:bg-plum-700 disabled:bg-plum-400 text-white rounded-lg text-sm font-medium transition-colors"
      >
        Apply
      </button>
      {backwards && (
        <p role="alert" className="basis-full text-xs text-red-700 dark:text-red-400">
          From is after To. Pick a From day on or before the To day.
        </p>
      )}
    </form>
  );
}
