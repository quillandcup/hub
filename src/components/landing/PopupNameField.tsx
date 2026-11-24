"use client";

import { createContext, useContext, useId, useState } from "react";
import { POPUP_NAME_MAX } from "@/lib/landing/exit-popup";
import { pagesSharing, popupNameOptions, resolvePopupName, type PopupNameUse } from "@/lib/landing/popup-names";

/** What the editor knows about the popup names in use on the site's pages (read on the server by the editor's page), and which page this is. */
export type PopupNamesContextValue = { uses: PopupNameUse[]; currentSlug: string };
export const PopupNamesContext = createContext<PopupNamesContextValue>({ uses: [], currentSlug: "" });

const NEW = "__new__";
const CONTROL = "mt-1 block w-full rounded-md border border-ink-muted bg-card px-3 py-2 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-600";

/**
 * The Exit popup's "Popup name": a choice between "This page only", the names other pages' popups already use, and a new name.
 * Popups with the same name share what is remembered about a close, so one close keeps them all away (docs/product/LANDING_PAGES.md,
 * "Exit popup"). The block stores the plain name, empty for this page only.
 */
export function PopupNameField({ label, value, onChange }: { label: string; value: unknown; onChange: (value: string) => void }) {
  const { uses, currentSlug } = useContext(PopupNamesContext);
  const id = useId();
  const current = typeof value === "string" ? value : "";
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const options = popupNameOptions(uses, current);
  const shared = pagesSharing(uses, current, currentSlug);

  function commit() {
    const name = resolvePopupName(draft, uses);
    setTyping(false);
    setDraft("");
    if (name) onChange(name);
  }

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        className={CONTROL}
        value={typing ? NEW : (options.find((o) => o.value === current)?.value ?? "")}
        onChange={(e) => {
          if (e.target.value === NEW) {
            setTyping(true);
            return;
          }
          setTyping(false);
          onChange(e.target.value);
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        <option value={NEW}>New name...</option>
      </select>
      {typing && (
        <input
          autoFocus
          aria-label="New popup name"
          className={CONTROL}
          maxLength={POPUP_NAME_MAX}
          value={draft}
          placeholder="For example: Newsletter"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
        />
      )}
      <p className="text-xs text-ink-muted">
        {!current
          ? "Closing this popup keeps it away on this page only."
          : shared.length > 0
            ? `Shared with ${shared.map((p) => p.title).join(", ")}: closing the popup on any of these pages keeps it away on all of them.`
            : "No other page uses this name yet. Give another page's popup the same name and a close on either keeps both away."}
      </p>
    </div>
  );
}
