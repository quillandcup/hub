import { InAppNotificationsProvider } from "@/components/InAppNotifications";
import { createClient } from "@/lib/supabase/server";
import type { EffectiveIdentity } from "@/lib/sudo";
import { BELL_LIMIT, countInAppNotifications, loadInAppNotifications } from "@/lib/channels/in-app";

/**
 * Loads the effective member's in-app notifications (app/actions/in-app-notifications.ts) and
 * shares them, through InAppNotificationsProvider, with everything inside: the header's bell and
 * banner and the inbox page. It adds no markup. Without a member (an admin with no member record
 * and no sudo) it renders `children` alone and the bell and banner stay hidden.
 */
export default async function WithInAppNotifications({
  identity,
  children,
}: {
  identity: EffectiveIdentity | null;
  children: React.ReactNode;
}) {
  if (!identity) return <>{children}</>;
  const supabase = await createClient();
  const [latest, unreadCount] = await Promise.all([
    loadInAppNotifications(supabase, identity.memberId, new Date(), { limit: BELL_LIMIT }),
    countInAppNotifications(supabase, identity.memberId, { unreadOnly: true }),
  ]);
  return <InAppNotificationsProvider initial={{ latest, unreadCount }}>{children}</InAppNotificationsProvider>;
}
