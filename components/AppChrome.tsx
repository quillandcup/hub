import AppHeader from "@/components/AppHeader";
import LiveRoomIndicator from "@/components/LiveRoomIndicator";
import {
  InAppNotificationBanner,
  InAppNotificationBell,
  InAppNotificationsProvider,
} from "@/components/InAppNotifications";
import { createClient } from "@/lib/supabase/server";
import { effectiveMemberHasFeature } from "@/lib/features.server";
import type { FeatureKey } from "@/lib/features";
import type { EffectiveIdentity } from "@/lib/sudo";
import { BELL_LIMIT, countInAppNotifications, loadInAppNotifications } from "@/lib/channels/in-app";

/**
 * Everything the member and admin layouts share from the header down: the header (hamburger,
 * search, On air light, notification bell, then `headerEnd`), the time-sensitive notification
 * banner under it, and the page (`children`). In-app notifications are the effective member's,
 * behind their own flag (app/actions/in-app-notifications.ts), so an admin with no member record
 * and no sudo gets none; the On air light is for everyone.
 */
export default async function AppChrome({
  resultsPath,
  isAdmin,
  identity,
  enabledFeatures,
  headerEnd,
  children,
}: {
  resultsPath: string;
  isAdmin: boolean;
  identity: EffectiveIdentity | null;
  enabledFeatures: FeatureKey[];
  headerEnd: React.ReactNode;
  children: React.ReactNode;
}) {
  const showInApp = identity ? await effectiveMemberHasFeature("in_app_notifications", identity, enabledFeatures) : false;
  const initial =
    identity && showInApp
      ? await (async () => {
          const supabase = await createClient();
          const [latest, unreadCount] = await Promise.all([
            loadInAppNotifications(supabase, identity.memberId, new Date(), { limit: BELL_LIMIT }),
            countInAppNotifications(supabase, identity.memberId, { unreadOnly: true }),
          ]);
          return { latest, unreadCount };
        })()
      : null;

  const page = (
    <>
      <AppHeader resultsPath={resultsPath} isAdmin={isAdmin}>
        <LiveRoomIndicator />
        {initial && <InAppNotificationBell />}
        {headerEnd}
      </AppHeader>
      {initial && <InAppNotificationBanner />}
      {children}
    </>
  );
  return initial ? <InAppNotificationsProvider initial={initial}>{page}</InAppNotificationsProvider> : page;
}
