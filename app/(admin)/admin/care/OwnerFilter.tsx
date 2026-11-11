"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import MemberAvatar from "@/app/(member)/members/[id]/MemberAvatar";
import EntitySearch from "@/components/EntitySearch";
import type { CareOwner } from "@/lib/care-owners";
import type { EngagementCardData } from "./card";

/** What the filter holds: everyone, the signed-in user's own, nobody's, or one owner's auth user id. */
export type OwnerChoice = "everyone" | "me" | "unassigned" | string;

const CHIP = "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs";

/**
 * The owner filter state of a tab, kept in the URL (`?owner=me`, `?owner=<user id>`, `?owner=unassigned`) so a reload or a
 * shared link lands on it. It is state within a tab: switching tabs drops the query (lib/tab-routes.ts), and the other tab
 * starts at everyone. The address is rewritten without a navigation.
 */
export function useOwnerChoice(): [OwnerChoice, (choice: OwnerChoice) => void] {
  const fromUrl = useSearchParams()?.get("owner") ?? "everyone";
  const [choice, setChoice] = useState<OwnerChoice>(fromUrl);
  const set = (next: OwnerChoice) => {
    setChoice(next);
    const params = new URLSearchParams(window.location.search);
    if (next === "everyone") params.delete("owner");
    else params.set("owner", next);
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  };
  return [choice, set];
}

/** Whether a card belongs to the chosen owner(s). */
export function matchesOwner(card: Pick<EngagementCardData, "ownerId">, choice: OwnerChoice, meId: string): boolean {
  if (choice === "everyone") return true;
  if (choice === "unassigned") return card.ownerId === null;
  return card.ownerId === (choice === "me" ? meId : choice);
}

/**
 * Narrows a tab to one owner: Mine and Everyone, a row of avatar chips (one per person who owns something here, with how many,
 * click to filter; click again to clear) and a search over the team for someone who owns nothing yet.
 */
export default function OwnerFilter({
  cards,
  owners,
  meId,
  choice,
  onChoose,
}: {
  /** Every card of the tab, before the filter. */
  cards: readonly EngagementCardData[];
  owners: readonly CareOwner[];
  meId: string;
  choice: OwnerChoice;
  onChoose: (choice: OwnerChoice) => void;
}) {
  const counts = new Map<string | null, { name: string; n: number }>();
  for (const c of cards) counts.set(c.ownerId, { name: c.ownerName, n: (counts.get(c.ownerId)?.n ?? 0) + 1 });
  const chips = [...counts].sort((a, b) => a[1].name.localeCompare(b[1].name));
  const selected = choice === "me" ? meId : choice;
  const toggle = (value: OwnerChoice) => onChoose(choice === value ? "everyone" : value);

  return (
    <div className="@container mb-3 flex flex-col gap-2 @pair:flex-row @pair:flex-wrap @pair:items-center" role="group" aria-label="Owner">
      <div className="flex gap-2">
        {(["everyone", "me"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={choice === value}
            onClick={() => onChoose(value)}
            className={`rounded-full border px-3 py-1 text-sm ${
              choice === value ? "border-plum-600 bg-plum-600 text-white" : "border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
            }`}
          >
            {value === "everyone" ? "Everyone" : "Mine"}
          </button>
        ))}
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-label="Owners">
        {chips.map(([ownerId, { name, n }]) => {
          const value = ownerId ?? "unassigned";
          const pressed = ownerId === null ? choice === "unassigned" : selected === ownerId;
          return (
            <li key={value}>
              <button
                type="button"
                aria-pressed={pressed}
                aria-label={`${name}, ${n}`}
                title={`${name}: ${n}`}
                onClick={() => toggle(value)}
                className={`${CHIP} ${pressed ? "border-plum-600 bg-plum-50 dark:bg-plum-900/30" : "border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"}`}
              >
                <MemberAvatar name={name} photoUrl={null} size={22} />
                <span aria-hidden="true">{n}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="min-w-48 @pair:max-w-64">
        <EntitySearch
          items={owners.map((o) => ({ id: o.id, name: o.name, detail: o.role === "admin" ? "Admin" : "Community manager" }))}
          selectedId={choice === "everyone" || choice === "me" || choice === "unassigned" ? null : choice}
          selectedName={owners.find((o) => o.id === choice)?.name ?? null}
          onSelect={(item) => onChoose(item?.id ?? "everyone")}
          placeholder="Find an owner"
          ariaLabel="Find an owner"
        />
      </div>
    </div>
  );
}
