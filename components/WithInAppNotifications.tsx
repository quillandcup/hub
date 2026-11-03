import { InAppNotificationsProvider } from "@/components/InAppNotifications";
import { createClient } from "@/lib/supabase/server";
import type { EffectiveIdentity } from "@/lib/sudo";
import { BELL_LIMIT, countInAppNotifications, loadInAppNotifications } from "@/lib/channels/in-app";
import { createRepos } from "@/lib/data/repos";
import type { BellState } from "@/app/actions/in-app-notifications";

/**
 * Loads the effective member's in-app notifications (app/actions/in-app-notifications.ts) and
 * shares them, through InAppNotificationsProvider, with everything inside: the header's bell and
 * banner and the inbox page. It adds no markup. Without a member (an admin with no member record
 * and no sudo) it renders `children` alone and the bell and banner stay hidden.
 */
export default function WithInAppNotifications({
  identity,
  children,
}: {
  identity: EffectiveIdentity | null;
  children: React.ReactNode;
}) {
  if (!identity) return <>{children}</>;
  // A promise, not an await: the page renders alongside the lookups, and the provider reads it on the client.
  return <InAppNotificationsProvider initial={loadBellState(identity)}>{children}</InAppNotificationsProvider>;
}

async function loadBellState(identity: EffectiveIdentity): Promise<BellState> {
  const supabase = await createClient();
  const [latest, unreadCount] = await Promise.all([
    loadInAppNotifications(createRepos(supabase), identity.memberId, new Date(), { limit: BELL_LIMIT }),
    countInAppNotifications(createRepos(supabase), identity.memberId, { unreadOnly: true }),
  ]);
  return { latest, unreadCount };
}
