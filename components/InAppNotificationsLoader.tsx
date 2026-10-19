import { InAppNotificationsProvider } from "@/components/InAppNotifications";
import { createClient } from "@/lib/supabase/server";
import { effectiveMemberHasFeature } from "@/lib/features.server";
import type { FeatureKey } from "@/lib/features";
import type { EffectiveIdentity } from "@/lib/sudo";
import { BELL_LIMIT, countInAppNotifications, loadInAppNotifications } from "@/lib/channels/in-app";

/**
 * Gives the header's bell and banner, and the inbox page, the effective member's in-app
 * notifications (app/actions/in-app-notifications.ts), behind their own flag. Without a member
 * (an admin with no member record and no sudo) or without the flag it renders `children` alone
 * and the bell and banner stay hidden.
 */
export default async function InAppNotifications({
  identity,
  enabledFeatures,
  children,
}: {
  identity: EffectiveIdentity | null;
  enabledFeatures: FeatureKey[];
  children: React.ReactNode;
}) {
  if (!identity || !(await effectiveMemberHasFeature("in_app_notifications", identity, enabledFeatures))) {
    return <>{children}</>;
  }
  const supabase = await createClient();
  const [latest, unreadCount] = await Promise.all([
    loadInAppNotifications(supabase, identity.memberId, new Date(), { limit: BELL_LIMIT }),
    countInAppNotifications(supabase, identity.memberId, { unreadOnly: true }),
  ]);
  return <InAppNotificationsProvider initial={{ latest, unreadCount }}>{children}</InAppNotificationsProvider>;
}
