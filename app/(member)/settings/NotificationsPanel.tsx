"use client";

import { useState } from "react";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_KINDS,
  type NotificationChannelId,
  type NotificationKindId,
} from "@/lib/notifications/registry";
import { ChannelIcon } from "@/components/ChannelIcon";
import { BrowserNotificationsToggle } from "./BrowserNotificationsToggle";
import { setNotificationChannel, type NotificationSettings } from "./notificationActions";

/**
 * Per-kind, per-channel notification switches: a row per kind (grouped by category), with a logo
 * toggle per channel right in the row (full colour = on, faded = off), so a long list never needs
 * a column header to read. Saves each change as it's made and reverts it if the save fails.
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
          Choose what the Hub tells you about, and where. Click a logo to turn that channel on or off; faded
          means off. Turn every channel off for a kind to stop it entirely.
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

      {initial.webPushPublicKey && (
        <BrowserNotificationsToggle publicKey={initial.webPushPublicKey} readOnly={initial.readOnly} />
      )}

      {categories.map((category) => (
        <section key={category}>
          <h3 className="border-b border-slate-200 pb-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300">
            {category}
          </h3>
          <ul className="text-sm">
            {NOTIFICATION_KINDS.filter((k) => k.category === category).map((kind) => (
              <li
                key={kind.id}
                className="flex items-center gap-4 border-b border-slate-100 py-3 dark:border-slate-800"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900 dark:text-slate-100">{kind.label}</div>
                  <div className="text-slate-500 dark:text-slate-400">{kind.description}</div>
                </div>
                <div className="flex shrink-0 gap-1">
                  {NOTIFICATION_CHANNELS.filter((c) => initial.channels.includes(c.id)).map((channel) => {
                    const on = channelsByKind[kind.id].includes(channel.id);
                    const busy = saving === `${kind.id}:${channel.id}`;
                    return (
                      <button
                        key={channel.id}
                        type="button"
                        aria-pressed={on}
                        aria-label={`${kind.label} via ${channel.label}`}
                        title={`${channel.label}: ${on ? "on" : "off"}${initial.readOnly ? "" : " (click to turn " + (on ? "off)" : "on)")}`}
                        disabled={initial.readOnly || busy}
                        aria-busy={busy}
                        onClick={() => toggle(kind.id, channel.id, !on)}
                        className={`rounded-md p-1.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-500 disabled:cursor-default ${
                          on
                            ? "bg-slate-100 dark:bg-slate-800"
                            : "opacity-30 grayscale hover:opacity-60 disabled:hover:opacity-30"
                        }`}
                      >
                        <ChannelIcon channel={channel.id} className="h-5 w-5" />
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
