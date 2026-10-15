import type { Metadata } from "next";
import Link from "next/link";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { parseUnsubscribeToken } from "@/lib/email-unsubscribe";
import { loadNotificationPreferences, NOTIFICATION_SETTINGS_PATH } from "@/lib/notifications/notify";
import { effectiveChannels, notificationKind } from "@/lib/notifications/registry";
import { SUPPORT_EMAIL } from "@/lib/config";
import { setEmailFromToken } from "./actions";

export const metadata: Metadata = { title: "Email notifications" };

// Where a notification email's "Unsubscribe" link lands. Public (no sign-in; the proxy lets it
// through): the signed token in ?t= names the member and the kind of notification. Viewing never
// changes anything, since link scanners open every link in an email; only the buttons do.
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const parsed = parseUnsubscribeToken(t);

  if (!parsed) {
    return (
      <Shell>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-3">This link doesn&apos;t work</h1>
        <p className="text-slate-600 dark:text-slate-400 mb-6">
          It may have been cut off when copied. You can change your emails any time in your notification settings, or
          email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-plum-600 dark:text-plum-400 hover:underline">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
        <SettingsLink />
      </Shell>
    );
  }

  const kind = notificationKind(parsed.kind);
  const preferences = await loadNotificationPreferences(createServiceRoleClient(), parsed.kind, [parsed.memberId]);
  const subscribed = effectiveChannels(parsed.kind, preferences.get(parsed.memberId) ?? []).includes("email");

  return (
    <Shell>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-3">
        {subscribed ? `Emails about ${kind.label.toLowerCase()}` : "You're unsubscribed"}
      </h1>
      <p className="text-slate-600 dark:text-slate-400 mb-6">
        {subscribed
          ? `You're getting emails about ${kind.label.toLowerCase()}. ${kind.description}`
          : `You won't get emails about ${kind.label.toLowerCase()} anymore. Other kinds of notifications and other channels follow your notification settings.`}
      </p>
      <form action={setEmailFromToken} className="mb-6">
        <input type="hidden" name="token" value={t} />
        <input type="hidden" name="enabled" value={subscribed ? "false" : "true"} />
        <button
          type="submit"
          className="px-4 py-2 rounded-md bg-plum-600 text-white hover:bg-plum-700 transition-colors"
        >
          {subscribed ? `Unsubscribe from these emails` : "Turn these emails back on"}
        </button>
      </form>
      <SettingsLink />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-lg shadow p-8 text-center">{children}</div>
    </div>
  );
}

function SettingsLink() {
  return (
    <p className="text-sm text-slate-500 dark:text-slate-400">
      Want to choose for every kind and channel?{" "}
      <Link href={NOTIFICATION_SETTINGS_PATH} className="text-plum-600 dark:text-plum-400 hover:underline">
        Open your notification settings
      </Link>{" "}
      (you&apos;ll be asked to sign in).
    </p>
  );
}
