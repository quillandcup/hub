"use client";

import { useState } from "react";
import {
  CHAT_NOTIFICATION_KINDS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_KINDS,
  type NotificationChannelId,
  type NotificationKindId,
} from "@/lib/notifications/registry";
import { ChannelIcon } from "@/components/ChannelIcon";
import { BrowserNotificationsToggle } from "./BrowserNotificationsToggle";
import { setChatMainPlace, setNotificationChannel, type NotificationSettings } from "./notificationActions";

/** Slack's own guide to configuring notifications (Slack has no API to read or change a member's preferences). */
const SLACK_NOTIFICATION_HELP_URL = "https://slack.com/help/articles/201355156-Configure-your-Slack-notifications";
import { trackSlug } from "@/lib/analytics/names";

/**
 * Per-kind, per-channel notification switches: a row per kind (grouped by category), with a logo
 * toggle per channel right in the row (full colour = on, faded = off), so a long list never needs
 * a column header to read. Saves each change as it's made and reverts it if the save fails.
 */
export function NotificationsPanel({ initial }: { initial: NotificationSettings }) {
  const [channelsByKind, setChannelsByKind] = useState(initial.channelsByKind);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mainPlace, setMainPlace] = useState(initial.chatMainPlace);
  const [savingMainPlace, setSavingMainPlace] = useState(false);

  const visibleKinds = NOTIFICATION_KINDS.filter((k) => initial.visibleKinds.includes(k.id));
  const categories = [...new Set(visibleKinds.map((k) => k.category))];

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

  const toggleMainPlace = async (on: boolean) => {
    const before = { mainPlace, channelsByKind };
    const turnedOn = initial.channels.filter((c) => c === "in_app" || c === "web_push");
    setMainPlace(on);
    setChannelsByKind((s) => ({ ...s, ...Object.fromEntries(CHAT_NOTIFICATION_KINDS.map((k) => [k, on ? turnedOn : []])) }));
    setSavingMainPlace(true);
    setError(null);
    const result = await setChatMainPlace(on);
    if ("error" in result) {
      setMainPlace(before.mainPlace);
      setChannelsByKind(before.channelsByKind);
      setError(result.error);
    }
    setSavingMainPlace(false);
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

      {initial.chatNotifications && (
        <section aria-labelledby="chat-main-place-heading" className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              role="switch"
              checked={mainPlace}
              disabled={initial.readOnly || savingMainPlace}
              aria-busy={savingMainPlace}
              data-track="settings-chat-main-place"
              onChange={(e) => toggleMainPlace(e.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <span>
              <span id="chat-main-place-heading" className="block font-medium text-slate-900 dark:text-slate-100">
                Hub chat is my main place
              </span>
              <span className="block text-sm text-slate-600 dark:text-slate-400">
                Tell me in the Hub about direct messages, mentions and the channels I follow, on the channels chosen below. Messages
                in conversations that are also in Slack are told to you by Slack too, so turn this on when you want Slack to stop.
              </span>
            </span>
          </label>
          {mainPlace && (
            <div className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400">
              <p className="font-medium text-slate-800 dark:text-slate-200">So Slack doesn&apos;t tell you twice</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5">
                <li>Open Slack, then Preferences, then Notifications.</li>
                <li>Under &ldquo;Notify me about&rdquo;, choose &ldquo;Nothing&rdquo; (or only the conversations you still want there).</li>
                <li>For a single conversation, open it in Slack and change its own notification setting.</li>
              </ol>
              <p className="mt-2">
                Slack doesn&apos;t let apps change these for you, so this has to be done in Slack.{" "}
                <a
                  href={SLACK_NOTIFICATION_HELP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-track="settings-chat-slack-help"
                  className="text-plum-600 underline dark:text-plum-400"
                >
                  Slack&apos;s guide to notifications
                </a>
              </p>
            </div>
          )}
        </section>
      )}

      {categories.map((category) => (
        <section key={category}>
          <h3 className="border-b border-slate-200 pb-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300">
            {category}
          </h3>
          <ul className="text-sm">
            {visibleKinds.filter((k) => k.category === category).map((kind) => (
              <li
                key={kind.id}
                id={`notification-${kind.id}`}
                className="flex items-center gap-4 border-b border-slate-100 py-3 dark:border-slate-800"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900 dark:text-slate-100">{kind.label}</div>
                  <div className="text-slate-600 dark:text-slate-400">{kind.description}</div>
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
                        data-track={`settings-notification-${trackSlug(kind.id)}-${trackSlug(channel.id)}`}
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
