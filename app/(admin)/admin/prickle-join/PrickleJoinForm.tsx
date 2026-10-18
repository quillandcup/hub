"use client";

import { useState } from "react";
import DatePicker from "@/components/DatePicker";
import { savePrickleJoin } from "./actions";

const inputClass =
  "w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm";

export default function PrickleJoinForm({
  url,
  passcode,
  timeZone,
  defaultStartDate,
  minStartDate,
}: {
  url: string;
  passcode: string;
  timeZone: string;
  defaultStartDate: string;
  minStartDate: string;
}) {
  const [urlValue, setUrl] = useState(url);
  const [passcodeValue, setPasscode] = useState(passcode);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [startNow, setStartNow] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMessage(null);
    const result = await savePrickleJoin({ url: urlValue, passcode: passcodeValue, startDate: startNow ? "" : startDate });
    setPending(false);
    setMessage("error" in result ? { ok: false, text: result.error ?? "Couldn't save" } : { ok: true, text: !startNow && startDate ? `Saved. Applies to prickles starting ${startDate} and later.` : "Saved. Applies to prickles starting now." });
  }

  return (
    <form onSubmit={submit} className="max-w-xl space-y-4">
      <div>
        <label htmlFor="join-url" className="block text-sm font-medium mb-1">
          One-click join link
        </label>
        <input id="join-url" type="url" required value={urlValue} onChange={(e) => setUrl(e.target.value)} className={inputClass} placeholder="https://us06web.zoom.us/j/…?pwd=…" />
      </div>
      <div>
        <label htmlFor="join-passcode" className="block text-sm font-medium mb-1">
          Passcode
        </label>
        <input id="join-passcode" value={passcodeValue} onChange={(e) => setPasscode(e.target.value)} className={inputClass} />
      </div>
      <div className="space-y-2">
        <DatePicker id="join-start" label="Starting on" value={startDate} onChange={setStartDate} min={minStartDate} disabled={startNow} required={!startNow} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} />
          Start right now instead
        </label>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          A date applies from midnight that day ({timeZone}), judged by when each prickle starts, so a late-night prickle belongs to the day it
          begins. Earlier prickles, and calendar events for them, keep their old link.
        </p>
      </div>
      {message && (
        <p className={`text-sm ${message.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{message.text}</p>
      )}
      <button type="submit" disabled={pending} className="px-4 py-2 text-sm bg-plum-600 text-white rounded-lg hover:bg-plum-700 disabled:opacity-50">
        {pending ? "Saving..." : "Save"}
      </button>
    </form>
  );
}
