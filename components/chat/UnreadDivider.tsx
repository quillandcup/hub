/**
 * The line across a conversation between what the member had read when they opened it (above) and
 * what is new (below), like Slack's. Opening a conversation scrolls to it (ChatLive finds it by id).
 */
export default function UnreadDivider() {
  return (
    <div id="unread-divider" role="separator" aria-label="New messages" className="my-2 flex items-center gap-2">
      <span className="h-px flex-1 bg-plum-500" />
      <span className="rounded-full bg-plum-600 px-2 py-0.5 text-xs font-medium text-white">New</span>
    </div>
  );
}
