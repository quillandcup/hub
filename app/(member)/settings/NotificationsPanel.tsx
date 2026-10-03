"use client";

import { useState } from "react";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_KINDS,
  type NotificationChannelId,
  type NotificationKindId,
} from "@/lib/notifications/registry";
import { setNotificationChannel, type NotificationSettings } from "./notificationActions";

/**
 * Per-kind, per-channel notification switches: a row per kind (grouped by category), a checkbox
 * per channel. Saves each change as it's made and reverts it if the save fails.
 */
export function NotificationsPanel({ initial }: { initial: NotificationSettings }) {
  const [channelsByKind, setChannelsByKind] = useState(initial.channelsByKind);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const categories = [...new Set(NOTIFICATION_KINDS.map((k) => k.category))];

  const toggle = async (kind: NotificationKindId, channel: NotificationChannelId, enabled: boolean) => {
    const before = channelsByKind[kind];
    const withChannel = (on: boolean) =>
      on ? [...before.filter((c) => c !== channel), channel] : before.filter((c) => c !== channel);
    setChannelsByKind((s) => ({ ...s, [kind]: withChannel(enabled) }));
    setSaving(`${kind}:${channel}`);
    setError(null);

    const result = await setNotificationChannel(kind, channel, enabled);
    if ("error" in result) {
      setChannelsByKind((s) => ({ ...s, [kind]: before }));
      setError(result.error);
    }
    setSaving(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100">Notifications</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Choose what the Hub tells you about, and where. Turn every channel off for a kind to stop it entirely.
        </p>
        {initial.readOnly && (
          <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
            You&apos;re viewing this member&apos;s settings in sudo mode; they can only be changed by the member.
          </p>
        )}
        {error && (
          <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>

      {categories.map((category) => (
        <table key={category} className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th scope="col" className="py-2 pr-4 text-left font-medium text-slate-700 dark:text-slate-300">
                {category}
              </th>
              {NOTIFICATION_CHANNELS.map((channel) => (
                <th
                  key={channel.id}
                  scope="col"
                  title={channel.description}
                  className="w-20 py-2 text-center font-medium text-slate-700 dark:text-slate-300"
                >
                  {channel.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_KINDS.filter((k) => k.category === category).map((kind) => (
              <tr key={kind.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-3 pr-4">
                  <div className="font-medium text-slate-900 dark:text-slate-100">{kind.label}</div>
                  <div className="text-slate-500 dark:text-slate-400">{kind.description}</div>
                </td>
                {NOTIFICATION_CHANNELS.map((channel) => (
                  <td key={channel.id} className="py-3 text-center">
                    <input
                      type="checkbox"
                      aria-label={`${kind.label} via ${channel.label}`}
                      checked={channelsByKind[kind.id].includes(channel.id)}
                      disabled={initial.readOnly || saving === `${kind.id}:${channel.id}`}
                      onChange={(e) => toggle(kind.id, channel.id, e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-plum-600 focus:ring-plum-500 disabled:opacity-50 dark:border-slate-600"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}
