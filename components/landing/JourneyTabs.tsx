"use client";

import { useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";

export type JourneyTab = { name: string; helps: string; panel: ReactNode };

const subscribe = () => () => {};

/** The one container a stage's content sits in: a left accent rail on a card, not a stack of bordered boxes. Attached to the stepper once it is a tab list. */
const PANEL = "border-2 border-l-8 border-accent bg-card p-5 text-ink @split:p-6";

/**
 * The Journey map's stepper and the panel under it (docs/LANDING_PAGES.md, "Homepage blocks"). The server renders every
 * stage's panel, so crawlers and visitors without JavaScript read all of them: before the browser has hydrated (and
 * forever without JavaScript) the stepper is the plain list it always was, the `initial` stage marked, and each panel
 * shows under its stage's name. Once hydrated it becomes a tab list (real buttons, `tablist` / `tab` / `tabpanel`, roving
 * tabindex, Left/Right/Up/Down/Home/End; focus selects, as in the app's own Tabs) and only the selected panel is shown.
 * Choosing a stage never navigates. The panels' own layout is the caller's (they arrive as nodes).
 */
export default function JourneyTabs({ tabs, initial }: { tabs: JourneyTab[]; initial: number }) {
  // false on the server and during hydration, true afterwards: no mismatch, no effect.
  const enhanced = useSyncExternalStore(subscribe, () => true, () => false);
  const [chosen, setChosen] = useState<number | null>(null);
  const base = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const count = tabs.length;
  const selected = Math.min(chosen ?? initial, count - 1);

  const stage = (i: number) => `-mt-0.5 flex-1 border-2 border-accent p-3 text-center first:mt-0 @cards:mt-0 @cards:-ml-0.5 @cards:first:ml-0 ${i === selected ? "bg-plum-700 text-white" : "bg-card text-ink"}`;

  if (!enhanced) {
    return (
      <>
        <ol className="flex flex-col @cards:flex-row">
          {tabs.map((tab, i) => (
            <li key={i} aria-current={i === initial ? "step" : undefined} className={stage(i)}>
              <p className="font-bold">{tab.name}</p>
              {tab.helps && <p className="text-sm">{tab.helps}</p>}
            </li>
          ))}
        </ol>
        {tabs.map((tab, i) => (
          <div key={i} className="mt-5">
            <p className="mb-2 font-bold">{tab.name}</p>
            <div className={`rounded-xl ${PANEL}`}>{tab.panel}</div>
          </div>
        ))}
      </>
    );
  }

  const choose = (i: number, focus: boolean) => {
    setChosen(i);
    if (focus) buttons.current[i]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % count : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i - 1 + count) % count : e.key === "Home" ? 0 : e.key === "End" ? count - 1 : null;
    if (to === null) return;
    e.preventDefault();
    choose(to, true);
  };

  return (
    <>
      <div role="tablist" aria-label="Stages of a book" className="flex flex-col @cards:flex-row">
        {tabs.map((tab, i) => (
          <button
            key={i}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${i}`}
            aria-selected={i === selected}
            aria-controls={`${base}-panel-${i}`}
            tabIndex={i === selected ? 0 : -1}
            onClick={() => choose(i, false)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`${stage(i)} relative cursor-pointer focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-current`}
          >
            <span className="block font-bold">{tab.name}</span>
            {tab.helps && <span className="block text-sm">{tab.helps}</span>}
          </button>
        ))}
      </div>
      {tabs.map((tab, i) => (
        <div key={i} role="tabpanel" id={`${base}-panel-${i}`} aria-labelledby={`${base}-tab-${i}`} hidden={i !== selected} className={`rounded-b-xl border-t-0 ${PANEL} ${i === selected ? "landing-panel-fade" : ""}`}>
          {tab.panel}
        </div>
      ))}
    </>
  );
}
