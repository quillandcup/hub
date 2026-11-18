"use client";

import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import Icon from "@/components/Icon";
import Kbd from "@/components/Kbd";
import { useShortcutsState } from "@/components/shortcuts/ShortcutsProvider";
import { visibleSections } from "@/lib/shortcuts";

/** How a key reads aloud (the key caps are decorative). */
const SPOKEN: Record<string, string> = {
  mod: "Control or Command",
  shift: "Shift",
  esc: "Escape",
  enter: "Enter",
  up: "Up arrow",
  down: "Down arrow",
  left: "Left arrow",
  right: "Right arrow",
  space: "Space",
  "/": "Slash",
  "?": "Question mark",
  "[": "Left square bracket",
  "]": "Right square bracket",
};

function spoken(chord: string[]): string {
  return chord.map((key) => SPOKEN[key.toLowerCase()] ?? key).join(" ");
}

/**
 * The page area and the panel side by side: the panel (when open) takes its width from the page instead of covering it.
 * Put it around the `<main>` of the member and admin layouts, inside `ShortcutsProvider`.
 */
export default function ShortcutsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1">
      {children}
      <ShortcutsPanel />
    </div>
  );
}

/**
 * Slack-style "Keyboard shortcuts" side panel, opened with `?` or from the Help menu. Not modal: the page stays usable
 * beside it, so it is a labelled landmark rather than a dialog, with no focus trap; Escape and the close button close it.
 * Lists the page's own shortcuts first (`useRegisterShortcuts`), then the ones that work everywhere (`lib/shortcuts.ts`).
 */
export function ShortcutsPanel() {
  const state = useShortcutsState();
  if (!state || !state.open) return null;
  return <PanelBody />;
}

function PanelBody() {
  const state = useShortcutsState()!;
  const titleId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const sections = visibleSections(state.registrations, query);

  // The cursor goes to the search box when the panel opens, and again when it is asked for while already open.
  useEffect(() => {
    searchRef.current?.focus();
  }, [state.openRequests]);

  return (
    <aside
      aria-labelledby={titleId}
      data-shortcuts-panel
      className="flex w-80 flex-shrink-0 flex-col border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
        <h2 id={titleId} className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Keyboard shortcuts
        </h2>
        <button
          type="button"
          onClick={state.closePanel}
          aria-label="Close keyboard shortcuts"
          aria-keyshortcuts="Escape"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="px-4 pb-2">
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search keyboard shortcuts"
          aria-label="Search keyboard shortcuts"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-500 focus:border-plum-500 focus:outline-none focus:ring-1 focus:ring-plum-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
        />
        <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
          <Kbd keys={["?"]} />
          <span>
            <span className="sr-only">Question mark </span>to toggle this panel
          </span>
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {sections.length === 0 && (
          <p role="status" className="py-4 text-sm text-slate-600 dark:text-slate-400">
            No shortcuts match &ldquo;{query.trim()}&rdquo;.
          </p>
        )}
        {sections.map((section, index) => (
          <section key={section.group} aria-labelledby={`${titleId}-${section.group}`} className="mt-4">
            {section.scope === "page-key" && sections[index - 1]?.scope !== "page-key" && (
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-plum-700 dark:text-plum-300">On this page</p>
            )}
            <h3 id={`${titleId}-${section.group}`} className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {section.section}
            </h3>
            <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-800">
              {section.shortcuts.map((shortcut) => (
                <li key={shortcut.id} className="flex items-start justify-between gap-3 py-1.5 text-sm text-slate-700 dark:text-slate-300">
                  <span>{shortcut.label}</span>
                  <span className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1 text-xs text-slate-600 dark:text-slate-400">
                    <span className="sr-only">{shortcut.keys.map(spoken).join(", or ")}</span>
                    {shortcut.keys.map((chord, i) => (
                      <Fragment key={chord.join("+")}>
                        {i > 0 && (
                          <span aria-hidden="true" className="px-0.5">
                            or
                          </span>
                        )}
                        <Kbd keys={chord} />
                      </Fragment>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
}
