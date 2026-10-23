"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import MemberAvatar from "@/app/(member)/members/[id]/MemberAvatar";
import {
  addChatMembers,
  joinChatChannel,
  removeChatMember,
  searchMembersToAdd,
  type MemberCandidate,
} from "@/app/(member)/chat/membership-actions";
import type { MembershipAbilities } from "@/lib/chat/membership-abilities";
import type { ChannelPerson } from "@/lib/chat/load";

const SEARCH_DELAY_MS = 250;

/**
 * Who is in a conversation, and the controls for changing it: join or leave, add people, and (staff only)
 * remove someone. The server decides what each of them may do (membership-actions.ts); `abilities` only
 * decides which controls to show. A change is made in Slack first and then here, so every control says
 * so, and what goes wrong is shown as Slack or the Hub put it.
 */
export default function MembersManager({
  channelId,
  channelLabel,
  isPrivate,
  people,
  viewerId,
  abilities,
}: {
  channelId: string;
  channelLabel: string;
  isPrivate: boolean;
  people: ChannelPerson[];
  viewerId: string;
  abilities: MembershipAbilities;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"leave" | string | null>(null);

  // Add people: search as they type, offer who matches, add on a click.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberCandidate[]>([]);
  const [searched, setSearched] = useState(false);
  const latestQuery = useRef("");
  useEffect(() => {
    latestQuery.current = query;
    if (query.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    const timer = setTimeout(async () => {
      const found = await searchMembersToAdd(channelId, query).catch(() => []);
      // An answer to something typed since is stale.
      if (latestQuery.current !== query) return;
      setResults(found);
      setSearched(true);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, channelId]);

  const run = async (change: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>, then?: () => void) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await change().catch(() => ({ ok: false as const, error: "Something went wrong. Try again." }));
    setBusy(false);
    setConfirming(null);
    if (!result.ok) return setError(result.error);
    if (result.message) setNotice(result.message);
    then?.();
    router.refresh();
  };

  const add = (candidate: MemberCandidate) =>
    run(() => addChatMembers(channelId, [candidate.memberId]), () => {
      setQuery("");
      setResults([]);
      setSearched(false);
    });

  return (
    <div className="space-y-6">
      {abilities.blocked && <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300">{abilities.blocked}</p>}

      {(abilities.canJoin || abilities.canLeave) && (
        <div className="flex flex-wrap items-center gap-3">
          {abilities.canJoin && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => joinChatChannel(channelId))}
              className="rounded-lg bg-plum-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-60"
            >
              {busy ? "Joining…" : `Join ${channelLabel}`}
            </button>
          )}
          {abilities.canLeave && confirming !== "leave" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming("leave")}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:hover:bg-slate-800"
            >
              Leave {channelLabel}
            </button>
          )}
          {abilities.canLeave && confirming === "leave" && (
            <span className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-600 dark:text-slate-400">Leave {channelLabel}?</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => removeChatMember(channelId, viewerId), () => router.push("/chat"))}
                className="rounded-md bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                {busy ? "Leaving…" : "Leave"}
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirming(null)} className="text-slate-600 hover:underline dark:text-slate-400">
                Stay
              </button>
            </span>
          )}
        </div>
      )}

      {abilities.canAdd && (
        <section aria-label="Add people">
          <label htmlFor="add-people" className="mb-1 block text-sm font-medium">
            Add people
          </label>
          <input
            id="add-people"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search members by name"
            autoComplete="off"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
          {results.length > 0 && (
            <ul aria-label="People to add" className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
              {results.map((c) => {
                const cantAdd = isPrivate && !c.inSlack;
                return (
                  <li key={c.memberId} className="flex items-center gap-3 px-3 py-2">
                    <MemberAvatar name={c.name} photoUrl={c.photoUrl} size={28} />
                    <span className="flex-1 text-sm">
                      {c.name}
                      {!c.inSlack && (
                        <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                          {cantAdd ? "Not in Slack, so can't join a private conversation" : "Not in Slack: only in the Hub"}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      disabled={busy || cantAdd}
                      aria-label={`Add ${c.name}`}
                      onClick={() => add(c)}
                      className="rounded-md bg-plum-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-plum-700 disabled:opacity-50"
                    >
                      Add
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {searched && results.length === 0 && <p className="mt-2 text-sm text-slate-500">No one to add matches that.</p>}
        </section>
      )}

      {notice && (
        <p role="status" className="text-sm text-slate-600 dark:text-slate-400">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {people.length === 0 ? (
        <p className="text-sm text-slate-500">No members to show.</p>
      ) : (
        <div className="@container">
          <ul className="grid gap-1 @pair:grid-cols-2">
            {people.map((p) => (
              <li key={p.memberId} className="flex items-center gap-1">
                <Link
                  data-track="chat-members-open-member"
                  href={`/members/${p.memberId}`}
                  className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <MemberAvatar name={p.name} photoUrl={p.photoUrl} size={32} />
                  <span className="truncate text-sm font-medium">{p.name}</span>
                </Link>
                {abilities.canRemoveOthers && p.memberId !== viewerId && confirming !== p.memberId && (
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Remove ${p.name}`}
                    onClick={() => setConfirming(p.memberId)}
                    className="shrink-0 rounded px-2 py-1 text-xs text-slate-500 hover:text-red-600 hover:underline disabled:opacity-60 dark:text-slate-400 dark:hover:text-red-400"
                  >
                    Remove
                  </button>
                )}
                {confirming === p.memberId && (
                  <span className="flex shrink-0 items-center gap-2 text-xs">
                    <span className="text-slate-600 dark:text-slate-400">Remove {p.name}?</span>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Confirm removing ${p.name}`}
                      onClick={() => run(() => removeChatMember(channelId, p.memberId))}
                      className="rounded-md bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-60"
                    >
                      {busy ? "Removing…" : "Remove"}
                    </button>
                    <button type="button" disabled={busy} onClick={() => setConfirming(null)} className="text-slate-600 hover:underline dark:text-slate-400">
                      Keep
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
