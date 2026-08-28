export interface SlackChannelRow {
  channel_id: string;
  name: string;
  is_private: boolean;
  imported_at: string;
}

export interface StalePrivateChannel {
  channelId: string;
  channelName: string;
  lastSeenAt: string;
}

/**
 * Flags private channels Billie Bot appears to have lost access to.
 *
 * The nightly Slack importer (`app/api/import/slack-api/route.ts`) upserts
 * every channel it can currently see into bronze.slack_channels, stamping a
 * fresh imported_at on each row. Private channels only show up in that list
 * while Billie Bot is still a member (Slack has no "list private channels
 * you're not in" API), so if Billie Bot gets removed, that channel's row
 * simply stops getting refreshed. A private channel whose imported_at lags
 * behind the most recent import batch is exactly that signal — there's no
 * way to auto-rejoin (an app can't invite itself), so this only detects the
 * problem for a human to fix with a manual re-invite.
 */
export function findStalePrivateChannels(channels: SlackChannelRow[]): StalePrivateChannel[] {
  if (channels.length === 0) return [];

  const latestImportedAt = channels.reduce(
    (max, c) => (c.imported_at > max ? c.imported_at : max),
    channels[0].imported_at
  );

  return channels
    .filter((c) => c.is_private && c.imported_at < latestImportedAt)
    .map((c) => ({ channelId: c.channel_id, channelName: c.name, lastSeenAt: c.imported_at }))
    .sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt));
}
