"use client";

import { useState } from "react";
import { setChatNotifySetting, type NotifySettingChoice } from "@/app/(member)/chat/notify-actions";

const LABELS: Record<NotifySettingChoice, string> = {
  default: "Default",
  all: "Every message",
  mentions: "Only mentions",
  nothing: "Nothing",
};

/**
 * What tells the member about this conversation, when Hub chat notifications are on for them (Settings -> Notifications):
 * the default of its kind (a direct message: every message; a channel: mentions), every message, only mentions, or nothing.
 * Saves as it changes and puts the old choice back if the save fails.
 */
export default function NotifySetting({ channelId, initial, isDirect }: { channelId: string; initial: NotifySettingChoice; isDirect: boolean }) {
  const [setting, setSetting] = useState<NotifySettingChoice>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const change = async (next: NotifySettingChoice) => {
    const before = setting;
    setSetting(next);
    setSaving(true);
    setError(null);
    const result = await setChatNotifySetting(channelId, next);
    if (!result.ok) {
      setSetting(before);
      setError(result.error);
    }
    setSaving(false);
  };

  return (
    <div className="shrink-0 text-sm">
      <label className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-400">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="sr-only">Notifications for this conversation</span>
        <select
          aria-label="Notifications for this conversation"
          value={setting}
          disabled={saving}
          data-track="chat-notify-setting"
          onChange={(e) => change(e.target.value as NotifySettingChoice)}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
        >
          {(Object.keys(LABELS) as NotifySettingChoice[]).map((value) => (
            <option key={value} value={value}>
              {value === "default" ? `Default (${isDirect ? "every message" : "mentions only"})` : LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
