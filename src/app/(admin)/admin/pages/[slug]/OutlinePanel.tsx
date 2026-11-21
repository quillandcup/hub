"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Puck, createUsePuck, type ComponentData } from "@puckeditor/core";
import AppIcon from "@/components/Icon";
import { SortableList, SortableRow } from "@/components/writing/SortableList";
import { DESIGN_HREF } from "@/components/landing/config";
import { AddListView, addGroups, restrictGroups } from "./SidePanels";
import { FieldsInLeftPanel } from "./fields-host";
import { ROOT_ZONE, allowedBlocks, childrenIn, findItem, labelOf, moveOf, rowOf, slotsOf, zoneOf, type ConfigLike, type OutlineRow, type SlotInfo } from "./outline-tree";

const usePuck = createUsePuck();

/**
 * The left panel's drill-down (the Kajabi way): one panel that starts at the page, goes into a section to its blocks, and into a block
 * to its fields. What is selected on the canvas decides the level, so clicking the canvas and clicking here are the same move, and
 * Back goes up one level.
 *
 * - **Page**: the header, the sections in order (drag, or the menu, to reorder), "Add section", the footer.
 * - **A block that holds blocks** (a section, columns, a list of cards): its blocks per slot, "Add block" (only what the slot takes), then its own settings.
 * - **Any other block**: its fields, here, so the right panel can stay closed and the canvas keeps its width. The header toggle pins
 *   the fields to the right panel instead; the block level then points there.
 */

const BACK = "flex items-center gap-1 rounded px-1.5 py-1 text-sm font-medium text-plum-700 hover:bg-plum-50 dark:text-plum-200 dark:hover:bg-slate-800";
const ROW_BUTTON =
  "flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-plum-500 dark:hover:bg-slate-800";
const ADD_BUTTON =
  "flex w-full items-center gap-2 rounded border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-plum-700 hover:bg-plum-50 dark:border-slate-600 dark:text-plum-200 dark:hover:bg-slate-800";
const HEADING = "px-1 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400";
const NOTE = "px-1 text-xs text-slate-600 dark:text-slate-400";

/** Where a new block goes and what it may be: one slot of a block, or the page's top level. */
export type AddTarget = { zone: string; index: number; allowed: string[]; title: string; noun: string };

function BackBar({ title, backTo, onBack }: { title: string; backTo: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-slate-200 px-2 py-2 dark:border-slate-700">
      <button type="button" onClick={onBack} className={BACK} aria-label={`Back to ${backTo}`}>
        <AppIcon name="chevron" className="h-3.5 w-3.5 rotate-90" />
        Back
      </button>
      <h2 className="min-w-0 truncate text-sm font-semibold">{title}</h2>
    </div>
  );
}

/** One list of blocks in order: each a button that opens it, with a drag handle and a "Move to position" menu (the keyboard and no-drag way) when there is more than one. */
export function RowGroup({ heading, rows, onOpen, onMove }: { heading?: string; rows: OutlineRow[]; onOpen: (id: string) => void; onMove: (from: number, to: number) => void }) {
  const ids = rows.map((r) => r.id);
  const labels = Object.fromEntries(rows.map((r) => [r.id, r.summary ? `${r.label} ${r.summary}` : r.label]));
  return (
    <section aria-label={heading} className="space-y-1">
      {heading && <h3 className={HEADING}>{heading}</h3>}
      {rows.length === 0 ? (
        <p className={NOTE}>Nothing here yet.</p>
      ) : (
        <SortableList
          ids={ids}
          labels={labels}
          onReorder={(after) => {
            const move = moveOf(ids, after);
            if (move) onMove(move.from, move.to);
          }}
        >
          <ul className="space-y-0.5">
            {rows.map((row, index) => (
              <li key={row.id}>
                <SortableRow
                  id={row.id}
                  label={labels[row.id]}
                  index={index}
                  count={rows.length}
                  disabled={false}
                  onMoveTo={(position) => onMove(index, position - 1)}
                  track="landing-outline"
                  className="rounded bg-white dark:bg-slate-900"
                  idleClassName=""
                  liftedClassName="shadow-lg ring-2 ring-plum-400 dark:ring-plum-500"
                >
                  {({ handle, menu }) => (
                    <div className="flex items-center gap-0.5">
                      {handle}
                      <button type="button" onClick={() => onOpen(row.id)} className={ROW_BUTTON}>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{row.label}</span>
                          {row.summary && <span className="block truncate text-xs text-slate-600 dark:text-slate-400">{row.summary}</span>}
                        </span>
                        {row.container && <AppIcon name="chevron" className="h-4 w-4 shrink-0 -rotate-90 text-slate-500" />}
                      </button>
                      {menu}
                    </div>
                  )}
                </SortableRow>
              </li>
            ))}
          </ul>
        </SortableList>
      )}
    </section>
  );
}

/** The grouped, searchable Add list narrowed to what one place takes; picking a block adds it there. */
export function AddPicker({ groups, target, onPick, onCancel }: { groups: ReturnType<typeof addGroups>; target: AddTarget; onPick: (type: string) => void; onCancel: () => void }) {
  const shown = useMemo(() => restrictGroups(groups, target.allowed), [groups, target.allowed]);
  return (
    <div>
      <BackBar title={target.title} backTo="the list" onBack={onCancel} />
      <AddListView
        groups={shown}
        draggable={false}
        renderItem={(item) => (
          <button
            type="button"
            onClick={() => onPick(item.name)}
            className="flex w-full items-center justify-between rounded border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:bg-plum-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
          >
            {item.label}
            <AppIcon name="plus" className="h-4 w-4 text-slate-500" />
          </button>
        )}
      />
    </div>
  );
}

function AddButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={ADD_BUTTON}>
      <AppIcon name="plus" className="h-4 w-4" />
      {children}
    </button>
  );
}

/** The page's header or footer. A website page's are shared and edited in Design (a link); a landing page's own are root fields, opened here. */
function RegionRow({ name, shared, onOpen }: { name: string; shared: boolean; onOpen: () => void }) {
  return shared ? (
    <a href={DESIGN_HREF} target="_blank" rel="noopener" className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
      <span>
        <span className="block font-medium">{name}</span>
        <span className="block text-xs text-slate-600 dark:text-slate-400">Shared by every website page. Edit it in Design.</span>
      </span>
      <AppIcon name="external" className="h-4 w-4 shrink-0 text-slate-500" />
    </a>
  ) : (
    <button type="button" onClick={onOpen} className="flex w-full items-center justify-between rounded border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
      <span className="block font-medium">{name}</span>
      <AppIcon name="chevron" className="h-4 w-4 shrink-0 -rotate-90 text-slate-500" />
    </button>
  );
}

/** The block's fields, in this panel (Puck's own field list, so every field type works), or a pointer when they are pinned to the right panel. */
function FieldsHere({ pinned }: { pinned: boolean }) {
  if (pinned) return <p className={`${NOTE} p-3`}>The fields are in the panel on the right. Turn off “Pin fields beside the page” in the header to edit them here.</p>;
  return (
    <FieldsInLeftPanel.Provider value={true}>
      <Puck.Fields />
    </FieldsInLeftPanel.Provider>
  );
}

export function OutlinePanel({ pageType, hiddenAtRoot }: { pageType: "website" | "landing"; hiddenAtRoot: readonly string[] }) {
  const config = usePuck((s) => s.config);
  const data = usePuck((s) => s.appState.data);
  const selectedItem = usePuck((s) => s.selectedItem);
  const pinned = usePuck((s) => s.appState.ui.rightSideBarVisible);
  const dispatch = usePuck((s) => s.dispatch);
  const getParentById = usePuck((s) => s.getParentById);
  const getSelectorForId = usePuck((s) => s.getSelectorForId);
  const [adding, setAdding] = useState<AddTarget | null>(null);
  const [regions, setRegions] = useState(false);
  const groups = useMemo(() => addGroups(config), [config]);

  const selectedId = selectedItem?.props.id ?? null;
  // The tree in the page's data has each block's slots filled in; read the selected block from it, not from the selection.
  const selected: ComponentData | null = selectedId ? (findItem(config, data.content as ComponentData[], selectedId) ?? selectedItem) : null;
  useEffect(() => {
    setAdding(null);
    setRegions(false);
  }, [selectedId]);

  const select = (id: string | null) => dispatch({ type: "setUi", ui: { itemSelector: id ? (getSelectorForId(id) ?? null) : null } });
  const move = (zone: string, from: number, to: number) => {
    if (from === to) return;
    dispatch({ type: "reorder", sourceIndex: from, destinationIndex: to, destinationZone: zone, recordHistory: true });
  };
  const add = (target: AddTarget, type: string) => {
    const id = `${type}-${crypto.randomUUID()}`;
    dispatch({ type: "insert", componentType: type, destinationIndex: target.index, destinationZone: target.zone, id, recordHistory: true });
    // Selecting it opens its level: a section shows its (empty) list to add to, any other block its fields.
    dispatch({ type: "setUi", ui: { itemSelector: { index: target.index, zone: target.zone } } });
  };

  if (adding) {
    return <AddPicker groups={groups} target={adding} onPick={(type) => add(adding, type)} onCancel={() => setAdding(null)} />;
  }

  if (!selected) {
    if (regions) {
      return (
        <div>
          <BackBar title="Header and footer" backTo="the page" onBack={() => setRegions(false)} />
          <FieldsHere pinned={pinned} />
        </div>
      );
    }
    const sections = (data.content as ComponentData[]).map((item) => rowOf(config, item));
    const target: AddTarget = { zone: ROOT_ZONE, index: sections.length, allowed: allowedBlocks(config, null, hiddenAtRoot), title: "Add section", noun: "section" };
    const shared = pageType === "website";
    return (
      <div className="space-y-3 p-3">
        <h2 className="px-1 text-sm font-semibold">Page</h2>
        <RegionRow name="Header" shared={shared} onOpen={() => setRegions(true)} />
        <RowGroup heading="Sections" rows={sections} onOpen={select} onMove={(from, to) => move(ROOT_ZONE, from, to)} />
        <AddButton onClick={() => setAdding(target)}>Add section</AddButton>
        <RegionRow name="Footer" shared={shared} onOpen={() => setRegions(true)} />
      </div>
    );
  }

  const parent = getParentById(selected.props.id);
  const backTo = parent ? labelOf(config, parent.type) : "the page";
  const bar = <BackBar title={labelOf(config, selected.type)} backTo={backTo} onBack={() => select(parent?.props.id ?? null)} />;
  const slots = slotsOf(config, selected.type);
  if (slots.length === 0) {
    return (
      <div>
        {bar}
        <FieldsHere pinned={pinned} />
      </div>
    );
  }
  return (
    <div>
      {bar}
      <div className="space-y-4 p-3">
        {slots.map((slot) => (
          <SlotList key={slot.key} owner={selected} slot={slot} single={slots.length === 1} config={config} onOpen={select} onMove={move} onAdd={(target) => (target.allowed.length === 1 ? add(target, target.allowed[0]) : setAdding(target))} />
        ))}
      </div>
      <h3 className={`${HEADING} border-t border-slate-200 px-4 pt-3 dark:border-slate-700`}>Settings</h3>
      <FieldsHere pinned={pinned} />
    </div>
  );
}

/** One slot of the open block: its blocks in order and the button that adds one. A slot that takes one kind of block adds it straight away ("Add step"). */
function SlotList({
  owner,
  slot,
  single,
  config,
  onOpen,
  onMove,
  onAdd,
}: {
  owner: ComponentData;
  slot: SlotInfo;
  single: boolean;
  config: ConfigLike;
  onOpen: (id: string) => void;
  onMove: (zone: string, from: number, to: number) => void;
  onAdd: (target: AddTarget) => void;
}) {
  const zone = zoneOf(owner.props.id, slot.key);
  const children = childrenIn(owner, slot.key);
  const allowed = allowedBlocks(config, slot);
  const noun = allowed.length === 1 ? labelOf(config, allowed[0]).toLowerCase() : "block";
  const target: AddTarget = { zone, index: children.length, allowed, title: `Add block${single ? "" : ` to ${slot.label.toLowerCase()}`}`, noun };
  return (
    <div className="space-y-2">
      <RowGroup heading={single ? undefined : slot.label} rows={children.map((c) => rowOf(config, c))} onOpen={onOpen} onMove={(from, to) => onMove(zone, from, to)} />
      <AddButton onClick={() => onAdd(target)}>Add {noun}</AddButton>
    </div>
  );
}

/** The rail's first tab. Named "outline" so it replaces Puck's own, which is a tree that opens in place. */
export const outlinePlugin = (pageType: "website" | "landing", hiddenAtRoot: readonly string[]) => ({
  name: "outline",
  label: "Outline",
  icon: <AppIcon name="outline" />,
  render: () => <OutlinePanel pageType={pageType} hiddenAtRoot={hiddenAtRoot} />,
});
