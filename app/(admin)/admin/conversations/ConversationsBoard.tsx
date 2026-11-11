"use client";

import { useState } from "react";
import { CONVERSATION_STATUS_LABELS, type ConversationStatus } from "@/lib/conversations";
import type { ConversationCardData } from "./card";
import ConversationCard from "./ConversationCard";
import StartConversationForm from "./StartConversationForm";

type Filter = "all" | ConversationStatus;
const FILTERS: Filter[] = ["all", "needs_reply", "gone_quiet", "waiting", "closed"];

/** The list, in the order the server sorted it (what needs her first), with a chip per status to narrow it. */
export default function ConversationsBoard({ cards, canWrite }: { cards: ConversationCardData[]; canWrite: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const count = (f: Filter) => (f === "all" ? cards.length : cards.filter((c) => c.status === f).length);
  const shown = filter === "all" ? cards : cards.filter((c) => c.status === filter);

  return (
    <div className="space-y-6">
      {canWrite && <StartConversationForm />}

      <section aria-label="Conversations">
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 text-sm ${
                filter === f
                  ? "border-plum-600 bg-plum-600 text-white"
                  : "border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              }`}
            >
              {f === "all" ? "All" : CONVERSATION_STATUS_LABELS[f]} ({count(f)})
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
            {cards.length === 0 ? "No conversations yet. Start one above." : "Nothing here."}
          </p>
        ) : (
          <ul className="space-y-3">
            {shown.map((card) => (
              <ConversationCard key={card.id} card={card} canWrite={canWrite} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
