import { NOTIFICATION_CHANNELS, type NotificationChannelId } from "@/lib/notifications/registry";

export interface NotificationKindRow {
  id: string;
  category: string;
  label: string;
  /** Channels it goes to for this member now (defaults with their choices applied). */
  channels: NotificationChannelId[];
  /** Channels this member chose differently from the default. */
  changed: NotificationChannelId[];
}

interface Props {
  /** Labels of the devices Browser notifications are on for, newest first. */
  devices: string[];
  /** The address on the member record, where the Email channel would go. */
  email: string;
  /** In their first 90 days, so the new-member defaults apply. */
  newcomer: boolean;
  kinds: NotificationKindRow[];
}

/** A member's notification setup, read-only: devices, reachability and each kind's channels. */
export default function MemberNotificationsPanel({ devices, email, newcomer, kinds }: Props) {
  return (
    <div className="space-y-6">
      <section className="bg-white dark:bg-slate-900 rounded-lg shadow p-6 space-y-2">
        <h2 className="text-lg font-semibold">Where they can be reached</h2>
        <ul className="text-sm text-slate-700 dark:text-slate-300 space-y-1">
          <li>
            Browser notifications:{" "}
            {devices.length === 0
              ? "not on for any device"
              : `${devices.length} ${devices.length === 1 ? "device" : "devices"} (${devices.join(", ")})`}
          </li>
          <li>Email: {email}</li>
        </ul>
      </section>

      <section className="bg-white dark:bg-slate-900 rounded-lg shadow p-6 space-y-3">
        <h2 className="text-lg font-semibold">Channels by kind</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Their choices on top of the defaults{newcomer ? " (they are in their first 90 days, so new-member defaults apply)" : ""}. A choice that differs from the default is marked with *.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-600 dark:text-slate-400">
                <th className="py-2 pr-4 font-medium">Kind</th>
                {NOTIFICATION_CHANNELS.map((c) => (
                  <th key={c.id} className="py-2 px-3 font-medium text-center">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {kinds.map((k) => (
                <tr key={k.id} className="border-t border-slate-200 dark:border-slate-700">
                  <td className="py-2 pr-4">
                    {k.label}
                    <div className="text-xs text-slate-500 dark:text-slate-400">{k.category}</div>
                  </td>
                  {NOTIFICATION_CHANNELS.map((c) => (
                    <td key={c.id} className="py-2 px-3 text-center">
                      {k.channels.includes(c.id) ? "On" : "Off"}
                      {k.changed.includes(c.id) && <span title="Chosen by the member, not the default">*</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
