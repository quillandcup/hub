"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ChannelSummary } from "@/lib/chat/load";

function Section({ title, channels, pathname }: { title: string; channels: ChannelSummary[]; pathname: string }) {
  if (channels.length === 0) return null;
  return (
    <div className="mb-4">
      <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 px-3">{title}</h2>
      <ul className="space-y-0.5">
        {channels.map((c) => {
          const active = pathname === `/chat/${c.id}`;
          return (
            <li key={c.id}>
              <Link
                href={`/chat/${c.id}`}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  active
                    ? "bg-plum-50 dark:bg-plum-900/20 text-plum-600 dark:text-plum-400 font-medium"
                    : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                <span className="truncate">{c.label}</span>
                {c.visibility === "private" && c.kind === "channel" && <span title="Private channel">🔒</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The conversations the member can open: channels, group messages, then archived ones. */
export default function ChatSidebar({ channels }: { channels: ChannelSummary[] }) {
  const pathname = usePathname();
  const live = channels.filter((c) => !c.archived);
  return (
    // Pinned and capped to the viewport with its own scroll: a long channel list must not set the
    // page's height, or short conversations scroll to a screenful of nothing below the messages.
    <nav aria-label="Conversations" className="md:sticky md:top-6 md:self-start md:max-h-[calc(100vh-7rem)] md:overflow-y-auto">
      <form action="/chat/search" role="search" className="mb-4 px-1">
        <input
          type="search"
          name="q"
          aria-label="Search chat"
          placeholder="Search chat"
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm"
        />
      </form>
      <Section title="Channels" channels={live.filter((c) => c.kind === "channel")} pathname={pathname} />
      <Section title="Group messages" channels={live.filter((c) => c.kind !== "channel")} pathname={pathname} />
      <Section title="Archived" channels={channels.filter((c) => c.archived)} pathname={pathname} />
      {channels.length === 0 && <p className="px-3 text-sm text-slate-500">No conversations yet.</p>}
    </nav>
  );
}
