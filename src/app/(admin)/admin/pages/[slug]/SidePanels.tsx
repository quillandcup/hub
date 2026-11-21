"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Drawer, createUsePuck, type ComponentData, type Config } from "@puckeditor/core";
import AppIcon from "@/components/Icon";
import { useFieldsInLeftPanel } from "./fields-host";

const usePuck = createUsePuck();

export type AddGroup = { key: string; title: string; items: { name: string; label: string }[] };

/** The blocks of a config as the Add list shows them: its categories in order, then anything left over under "Other". */
export function addGroups(config: Pick<Config, "components" | "categories">): AddGroup[] {
  const labelOf = (name: string) => (config.components[name] as { label?: string } | undefined)?.label ?? name;
  const used = new Set<string>();
  const groups: AddGroup[] = Object.entries(config.categories ?? {}).map(([key, category]) => {
    const items = (category.components ?? []).filter((name) => config.components[name]).map((name) => ({ name, label: labelOf(name) }));
    items.forEach((i) => used.add(i.name));
    return { key, title: category.title ?? key, items };
  });
  const rest = Object.keys(config.components).filter((name) => !used.has(name));
  if (rest.length > 0) groups.push({ key: "other", title: "Other", items: rest.map((name) => ({ name, label: labelOf(name) })) });
  return groups.filter((g) => g.items.length > 0);
}

/** Keeps the blocks whose name matches every typed word, and the groups that still have one. */
export function filterGroups(groups: AddGroup[], query: string): AddGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return groups;
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => words.every((w) => `${i.label} ${i.name} ${g.title}`.toLowerCase().includes(w))) }))
    .filter((g) => g.items.length > 0);
}

/** Keeps only the blocks named in `allowed`, and the groups that still have one: the same list, narrowed to what a place takes. */
export function restrictGroups(groups: AddGroup[], allowed: readonly string[]): AddGroup[] {
  return groups.map((g) => ({ ...g, items: g.items.filter((i) => allowed.includes(i.name)) })).filter((g) => g.items.length > 0);
}

/**
 * The Add list: blocks grouped by category, collapsed except the first, with a search box. Presentational, so it can be tested without Puck.
 * `draggable` (the rail's Add tab) wraps each group in Puck's Drawer so items drag onto the canvas; without it (the drill-down's "Add section" and
 * "Add block") items are plain rows the caller makes clickable.
 */
export function AddListView({ groups, renderItem, draggable = true }: { groups: AddGroup[]; renderItem: (item: { name: string; label: string }) => ReactNode; draggable?: boolean }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const searching = query.trim() !== "";
  const shown = useMemo(() => filterGroups(groups, query), [groups, query]);
  const isOpen = (g: AddGroup) => searching || (open[g.key] ?? g.key === groups[0]?.key);
  return (
    <div className="space-y-2 p-3 text-sm">
      <label className="block font-medium">
        Search blocks
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Heading, button, schedule…"
          className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        />
      </label>
      {shown.length === 0 && <p className="text-slate-600 dark:text-slate-400">No block matches “{query.trim()}”.</p>}
      {shown.map((g) => {
        const expanded = isOpen(g);
        return (
          <section key={g.key}>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setOpen((o) => ({ ...o, [g.key]: !expanded }))}
              className="flex w-full items-center justify-between rounded px-1 py-1.5 text-left font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <span>
                {g.title} <span className="font-normal text-slate-600 dark:text-slate-400">({g.items.length})</span>
              </span>
              <AppIcon name="chevron" className={`h-4 w-4 transition-transform ${expanded ? "" : "-rotate-90"}`} />
            </button>
            {expanded &&
              (draggable ? (
                <Drawer droppableId={`add-${g.key}`}>
                  {g.items.map((item) => (
                    <div key={item.name}>{renderItem(item)}</div>
                  ))}
                </Drawer>
              ) : (
                <ul className="space-y-1.5">
                  {g.items.map((item) => (
                    <li key={item.name}>{renderItem(item)}</li>
                  ))}
                </ul>
              ))}
          </section>
        );
      })}
    </div>
  );
}

function AddList() {
  const config = usePuck((s) => s.config);
  const groups = useMemo(() => addGroups(config), [config]);
  return <AddListView groups={groups} renderItem={(item) => <Drawer.Item name={item.name} label={item.label} />} />;
}

/** The left rail's list of blocks to add, in place of Puck's long always-open one. Same name, so it replaces Puck's. */
export const addPlugin = { name: "blocks", label: "Add", icon: <AppIcon name="plus" />, render: () => <AddList /> };

/** One step in the path from the page to the selected block. */
export type Crumb = { id: string | null; label: string };

/** The right panel's heading when something is selected: the path from the page, and Back to the level above. Presentational. */
export function BreadcrumbView({ crumbs, onSelect }: { crumbs: Crumb[]; onSelect: (id: string | null) => void }) {
  if (crumbs.length === 0) return null;
  const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2] : null;
  return (
    <nav aria-label="Where you are" className="flex flex-wrap items-center gap-1 border-b border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
      <button
        type="button"
        onClick={() => onSelect(parent?.id ?? null)}
        className="mr-1 flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-plum-700 hover:bg-plum-50 dark:text-plum-200 dark:hover:bg-slate-800"
      >
        <AppIcon name="chevron" className="h-3.5 w-3.5 rotate-90" />
        Back
      </button>
      <ol className="flex flex-wrap items-center gap-1 text-slate-600 dark:text-slate-400">
        <li>
          <button type="button" onClick={() => onSelect(null)} className="rounded px-1 hover:underline">
            Page
          </button>
        </li>
        {crumbs.map((c, i) => (
          <li key={`${c.id}-${i}`} className="flex items-center gap-1">
            <span aria-hidden="true">/</span>
            {i === crumbs.length - 1 ? (
              <span aria-current="location" className="font-semibold text-slate-900 dark:text-slate-100">
                {c.label}
              </span>
            ) : (
              <button type="button" onClick={() => onSelect(c.id)} className="rounded px-1 hover:underline">
                {c.label}
              </button>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function SelectionPath() {
  const inLeft = useFieldsInLeftPanel();
  const selected = usePuck((s) => s.selectedItem);
  const config = usePuck((s) => s.config);
  const getParentById = usePuck((s) => s.getParentById);
  const getSelectorForId = usePuck((s) => s.getSelectorForId);
  const dispatch = usePuck((s) => s.dispatch);
  if (inLeft || !selected) return null;
  const labelOf = (item: ComponentData) => (config.components[item.type] as { label?: string } | undefined)?.label ?? item.type;
  const crumbs: Crumb[] = [{ id: selected.props.id, label: labelOf(selected) }];
  for (let parent = getParentById(selected.props.id), guard = 0; parent && guard < 20; parent = getParentById(parent.props.id), guard++) {
    crumbs.unshift({ id: parent.props.id, label: labelOf(parent) });
  }
  return (
    <BreadcrumbView
      crumbs={crumbs}
      onSelect={(id) => dispatch({ type: "setUi", ui: { itemSelector: id ? (getSelectorForId(id) ?? null) : null } })}
    />
  );
}

/** The rail tab that holds the drill-down. Puck's own outline has this name, so ours replaces it. */
export const OUTLINE_PLUGIN = "outline";

/** A new selection (a click on the canvas) takes the left panel to the outline, where that block's level is. It never opens a hidden panel, so a canvas made wide stays wide. */
export function ShowOutlineOnSelect() {
  const selectedId = usePuck((s) => s.selectedItem?.props.id ?? null);
  const current = usePuck((s) => s.appState.ui.plugin?.current);
  const dispatch = usePuck((s) => s.dispatch);
  useEffect(() => {
    if (selectedId && current !== OUTLINE_PLUGIN) dispatch({ type: "setUi", ui: { plugin: { current: OUTLINE_PLUGIN } } });
    // Only a new selection moves the tab: choosing Add or AI by hand must stick while the same block stays selected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);
  return null;
}

/** Puck overrides for the panels: fields pinned on the right get the path above them, and a new selection shows the outline. */
export const panelOverrides = {
  fields: ({ children }: { children: ReactNode }) => (
    <>
      <SelectionPath />
      {children}
    </>
  ),
  puck: ({ children }: { children: ReactNode }) => (
    <>
      <ShowOutlineOnSelect />
      {children}
    </>
  ),
};
