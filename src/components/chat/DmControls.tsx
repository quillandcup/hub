"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import EntitySearch, { type SearchItem } from "@/components/EntitySearch";
import { pressChatDmControl } from "@/app/(member)/chat/dm-controls-actions";
import { pokeChat } from "@/lib/chat/list-events";
import type { BlocksUnfurl, ControlItem, PressButton, SelectGroup } from "@/lib/chat/unfurls";

/**
 * The working controls of Billie Bot's check-in and check-out DMs, drawn in the Hub chat (the buttons, the lists and the
 * fill-in number: src/lib/chat/unfurls.ts parses only the ones src/lib/chat/dm-controls.ts recognises). A press goes to the
 * server (src/app/(member)/chat/dm-controls-actions.ts), which saves it and updates the Slack message like Slack's own buttons
 * do; the card then shows the blocks it sends back, without waiting for the Slack copy to come round.
 * Without a scope (a message that isn't the viewer's, or someone acting as a member) a control is not drawn as one.
 */

interface Press {
  blockId: string;
  actionId: string;
  value?: string;
  selectedValue?: string;
}

interface Scope {
  busy: boolean;
  error: string | null;
  press: (p: Press) => Promise<void>;
}

const DmScopeContext = createContext<Scope | null>(null);

/** Wraps the blocks of one message: it knows where the message is and what to do with the answer. */
export function DmScope({ channelId, messageId, onUpdated, children }: { channelId: string; messageId: string; onUpdated: (unfurl: BlocksUnfurl) => void; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function press(p: Press) {
    setBusy(true);
    setError(null);
    try {
      const result = await pressChatDmControl({ channelId, messageId, ...p });
      if (result.ok) {
        if (result.unfurl) onUpdated(result.unfurl);
        pokeChat(channelId);
      } else {
        setError(result.error);
      }
    } catch {
      setError("That didn't work. Try again, or answer in Slack.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DmScopeContext.Provider value={{ busy, error, press }}>
      {children}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </DmScopeContext.Provider>
  );
}

function OpenInSlack({ permalink }: { permalink: string | null }) {
  return permalink ? (
    <p className="text-xs">
      <a href={permalink} target="_blank" rel="noopener noreferrer" className="text-plum-600 dark:text-plum-400 hover:underline">
        Open in Slack
      </a>{" "}
      <span className="text-slate-600 dark:text-slate-400">to answer this.</span>
    </p>
  ) : (
    <p className="text-xs text-slate-600 dark:text-slate-400">This can only be answered in Slack.</p>
  );
}

const BUTTON =
  "inline-flex items-center rounded border px-2.5 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-500 disabled:opacity-60";
const PLAIN = "border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800";
const PRIMARY = "border-plum-700 bg-plum-700 text-white hover:bg-plum-800 dark:border-plum-500 dark:bg-plum-600";
const DANGER = "border-red-700 bg-red-700 text-white hover:bg-red-800";

/** A row of buttons: a scale (the saved point filled in), Submit, Skip, and any link beside them. */
export function DmButtonRow({ blockId, items, permalink }: { blockId: string; items: ControlItem[]; permalink: string | null }) {
  const scope = useContext(DmScopeContext);
  if (!scope) {
    const links = items.flatMap((i) => (i.kind === "link" ? [i.button] : []));
    return (
      <div className="space-y-1">
        {links.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {links.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className={`${BUTTON} ${PLAIN}`}>
                {l.label}
              </a>
            ))}
          </div>
        )}
        <OpenInSlack permalink={permalink} />
      </div>
    );
  }
  const press = (b: PressButton) => scope.press({ blockId, actionId: b.actionId, value: b.value });
  return (
    <div className="flex flex-wrap gap-2" role="group">
      {items.map((item, i) =>
        item.kind === "link" ? (
          <a key={i} href={item.button.url} target="_blank" rel="noopener noreferrer" data-track="chat-unfurl-link" className={`${BUTTON} ${PLAIN}`}>
            {item.button.label}
          </a>
        ) : (
          <button
            key={i}
            type="button"
            disabled={scope.busy}
            aria-pressed={item.button.actionId.startsWith("prickle_checkin_answer:") ? item.button.style === "primary" : undefined}
            onClick={() => void press(item.button)}
            data-track="chat-dm-control"
            className={`${BUTTON} ${item.button.style === "primary" ? PRIMARY : item.button.style === "danger" ? DANGER : PLAIN}`}
          >
            {item.button.label}
          </button>
        )
      )}
    </div>
  );
}

/** The options as search items: the group is the second line, so typing a core feeling finds everything under it. */
function itemsOf(groups: SelectGroup[]): SearchItem[] {
  return groups.flatMap((g) => g.options.map((o) => ({ id: o.value, name: o.label, detail: g.label && g.label !== o.label ? g.label : null })));
}

/** A question answered from a list: type to filter, or pick. Clearing the pick clears the answer. */
export function DmSelect({ blockId, actionId, placeholder, groups, selected, label, permalink }: { blockId: string; actionId: string; placeholder: string | null; groups: SelectGroup[]; selected: string | null; label: string; permalink: string | null }) {
  const scope = useContext(DmScopeContext);
  if (!scope) return <OpenInSlack permalink={permalink} />;
  return (
    <EntitySearch
      className="max-w-sm"
      items={itemsOf(groups)}
      browse
      selectedId={selected}
      placeholder={placeholder ?? "Pick one"}
      ariaLabel={label}
      emptyText="Nothing matches"
      onSelect={(item) => void scope.press({ blockId, actionId, ...(item ? { selectedValue: item.id } : {}) })}
    />
  );
}

/** A fill-in number, sent when Enter is pressed. */
export function DmNumberInput({ blockId, actionId, placeholder, min, label, permalink }: { blockId: string; actionId: string; placeholder: string | null; min: number | null; label: string; permalink: string | null }) {
  const scope = useContext(DmScopeContext);
  const [typed, setTyped] = useState("");
  if (!scope) return <OpenInSlack permalink={permalink} />;
  return (
    <input
      type="number"
      inputMode="numeric"
      min={min ?? undefined}
      step={1}
      value={typed}
      disabled={scope.busy}
      placeholder={placeholder ?? undefined}
      aria-label={label}
      onChange={(e) => setTyped(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" || e.nativeEvent.isComposing || typed.trim() === "") return;
        e.preventDefault();
        void scope.press({ blockId, actionId, value: typed.trim() });
      }}
      className="w-full max-w-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-plum-500"
    />
  );
}
