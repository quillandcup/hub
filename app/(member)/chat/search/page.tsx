import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireChat } from "@/lib/chat/access";
import { firstParam, isUuid, parseDay } from "@/lib/chat/format";
import { chatTextContext, loadChatChannels } from "@/lib/chat/load";
import { MAX_QUERY_LENGTH, searchChat } from "@/lib/chat/search";
import { parseSearch } from "@/lib/chat/search-syntax";
import MessageItem from "@/components/chat/MessageItem";

export const metadata: Metadata = {
  title: "Search · Chat",
};

type Param = string | string[] | undefined;

const inputClass =
  "w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm";

/**
 * /chat/search: full-text search over the messages the member can read. The search runs under RLS
 * (deleted messages and content the viewer can't read never match); it is scoped to the same
 * conversations the sidebar lists, and in sudo to the viewed member's unrestricted channels.
 */
export default async function ChatSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: Param; channel?: Param; author?: Param; from?: Param; to?: Param; files?: Param; thread?: Param; page?: Param }>;
}) {
  const { identity } = await requireChat();
  const sp = await searchParams;
  const q = (firstParam(sp.q) ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const channelParam = firstParam(sp.channel);
  const parsed = parseSearch(q);
  const formAuthor = (firstParam(sp.author) ?? "").trim().slice(0, 100);
  const author = parsed.from && parsed.from.toLowerCase() !== "me" ? parsed.from : formAuthor;
  const from = parsed.after ?? parseDay(sp.from);
  const to = parsed.before ?? parseDay(sp.to, 1);
  const hasFiles = parsed.hasFiles || firstParam(sp.files) === "1";
  const inThread = parsed.isThread || firstParam(sp.thread) === "1";
  const hasFilters = Boolean(
    parsed.tsquery || parsed.from || parsed.inChannel || parsed.after || parsed.before || parsed.hasFiles || parsed.hasLink || parsed.hasReaction || parsed.isThread
  );
  const pageNumber = Math.min(Math.max(Number.parseInt(firstParam(sp.page) ?? "0", 10) || 0, 0), 500);

  const supabase = await createClient();
  const all = await loadChatChannels(supabase, identity.memberId, identity.isSudo);
  const searchable = all.filter((c) => !(identity.isSudo && c.restricted));
  let scope = isUuid(channelParam) ? searchable.filter((c) => c.id === channelParam) : searchable;
  if (parsed.inChannel) {
    // in:#name (or the name of a group message); an unknown name searches nothing, as in Slack.
    const wanted = parsed.inChannel.toLowerCase();
    scope = scope.filter((c) => c.label.replace(/^#/, "").toLowerCase() === wanted);
  }

  const page =
    q && hasFilters
      ? await searchChat(supabase, identity.memberId, {
          tsquery: parsed.tsquery,
          channels: scope,
          author,
          authorMemberId: parsed.from?.toLowerCase() === "me" ? identity.memberId : undefined,
          from,
          to,
          hasFiles,
          inThread,
          hasLink: parsed.hasLink,
          hasReaction: parsed.hasReaction,
          page: pageNumber,
        })
      : null;
  const ctx = chatTextContext(page?.render ?? { userNames: {}, userMembers: {}, channelNames: {}, customEmoji: {} }, all);

  const linkTo = (n: number) => {
    const p = new URLSearchParams();
    p.set("q", q);
    if (isUuid(channelParam)) p.set("channel", channelParam);
    if (author) p.set("author", author);
    if (firstParam(sp.from) && parseDay(sp.from)) p.set("from", firstParam(sp.from) as string);
    if (firstParam(sp.to) && parseDay(sp.to, 1)) p.set("to", firstParam(sp.to) as string);
    if (hasFiles) p.set("files", "1");
    if (inThread) p.set("thread", "1");
    if (n > 0) p.set("page", String(n));
    return `/chat/search?${p.toString()}`;
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-3">Search chat</h1>
      <form action="/chat/search" role="search" className="mb-5 space-y-3">
        <div className="flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q}
            maxLength={MAX_QUERY_LENGTH}
            placeholder={'Search messages, e.g. "a phrase" -excluded from:@name in:#channel after:2026-01-01 has:link'}
            aria-label="Search messages"
            className={inputClass}
          />
          <button type="submit" className="px-4 py-1.5 rounded-lg bg-plum-600 text-white text-sm font-medium hover:bg-plum-700">
            Search
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-4 text-sm">
          <label className="block">
            <span className="block text-xs text-slate-500 mb-0.5">Channel</span>
            <select name="channel" defaultValue={isUuid(channelParam) ? channelParam : ""} className={inputClass}>
              <option value="">All conversations</option>
              {searchable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs text-slate-500 mb-0.5">From (name)</span>
            <input type="text" name="author" defaultValue={author} maxLength={100} className={inputClass} />
          </label>
          <label className="block">
            <span className="block text-xs text-slate-500 mb-0.5">On or after</span>
            <input type="date" name="from" defaultValue={parseDay(sp.from) ? firstParam(sp.from) : ""} className={inputClass} />
          </label>
          <label className="block">
            <span className="block text-xs text-slate-500 mb-0.5">On or before</span>
            <input type="date" name="to" defaultValue={parseDay(sp.to, 1) ? firstParam(sp.to) : ""} className={inputClass} />
          </label>
        </div>
        <div className="flex gap-4 text-sm">
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" name="files" value="1" defaultChecked={hasFiles} /> Has files
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" name="thread" value="1" defaultChecked={inThread} /> Only thread replies
          </label>
        </div>
      </form>
      <p className="-mt-3 mb-5 text-xs text-slate-500 dark:text-slate-400">
        Slack search syntax works: <code>&quot;exact phrase&quot;</code>, <code>-word</code>, <code>word*</code>, <code>in:#channel</code>,{" "}
        <code>from:@name</code> or <code>from:me</code>, <code>before:</code>, <code>after:</code>, <code>on:</code>, <code>during:</code> (2026-10-09, 2026-10 or 2026),{" "}
        <code>has:file</code>, <code>has:link</code>, <code>has:reaction</code>, <code>is:thread</code>.
      </p>

      {page && (
        <section aria-label="Results">
          {page.results.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {pageNumber > 0 ? "No more results." : "No messages match. Deleted messages and ones you can't read aren't searched."}
            </p>
          ) : (
            <ul>
              {page.results.map((r) => (
                <li key={r.message.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                  <p className="pt-3 text-xs text-slate-500 dark:text-slate-400">
                    <Link href={`/chat/${r.channel.id}`} className="font-medium hover:underline">
                      {r.channel.label}
                    </Link>
                    {" · "}
                    <Link
                      href={`/chat/${r.channel.id}?thread=${r.threadId}#m-${r.message.id}`}
                      className="text-plum-600 dark:text-plum-400 hover:underline"
                    >
                      {r.threadId === r.message.id ? "Open" : "Open thread"}
                    </Link>
                  </p>
                  <MessageItem message={r.message} ctx={ctx} channelId={r.channel.id} inThread />
                </li>
              ))}
            </ul>
          )}
          <nav aria-label="Pages" className="mt-3 flex gap-4 text-sm">
            {pageNumber > 0 && (
              <Link href={linkTo(pageNumber - 1)} className="text-plum-600 dark:text-plum-400 hover:underline">
                ← Previous
              </Link>
            )}
            {page.hasMore && (
              <Link href={linkTo(pageNumber + 1)} className="text-plum-600 dark:text-plum-400 hover:underline">
                More results →
              </Link>
            )}
          </nav>
        </section>
      )}
    </div>
  );
}
