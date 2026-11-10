"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import EntitySearch from "@/components/EntitySearch";
import { searchDmCandidates, startDirectMessage } from "@/app/(member)/chat/dm-actions";

/**
 * The icon in the Direct messages heading and the panel under it: find a member by name and open a
 * direct message with them. Escape, a click outside or choosing someone closes it; a refusal from
 * `startDirectMessage` (they haven't connected Slack...) shows in the panel.
 */
export default function NewMessagePicker({ pathname }: { pathname: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  // Opening a conversation closes it too.
  useEffect(() => setOpen(false), [pathname]);

  const choose = (memberId: string) => {
    setError(null);
    startTransition(async () => {
      const result = await startDirectMessage(memberId);
      if (result.ok) {
        setOpen(false);
        router.push(`/chat/${result.channelId}`);
      } else setError(result.error);
    });
  };

  return (
    <div ref={root}>
      <button
        type="button"
        data-track="chat-sidebar-new-message"
        aria-label="New message"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="New message"
        onClick={() => {
          setError(null);
          setOpen((o) => !o);
        }}
        className={`rounded p-1 text-slate-600 hover:bg-slate-200 focus-visible:opacity-100 group-hover:opacity-100 dark:text-slate-400 dark:hover:bg-slate-700 [@media(hover:none)]:opacity-100 ${
          open ? "bg-slate-200 opacity-100 dark:bg-slate-700" : "opacity-0"
        }`}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M8 3v10M3 8h10" />
        </svg>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="New message"
          className="absolute inset-x-0 top-full z-20 mt-1 rounded-lg border border-slate-300 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          <p className="px-1 pb-1 text-xs font-semibold text-slate-600 dark:text-slate-400">Message someone</p>
          <fieldset disabled={pending} className="contents">
            <EntitySearch
              search={searchDmCandidates}
              selectedId={null}
              onSelect={(item) => item && choose(item.id)}
              placeholder="Find a member"
              emptyText="No one found."
              autoFocus
            />
          </fieldset>
          {pending && <p className="px-1 pt-1 text-sm text-slate-600 dark:text-slate-400">Opening…</p>}
          {error && (
            <p role="alert" className="px-1 pt-1 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
