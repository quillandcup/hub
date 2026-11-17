"use client";

import { useState, type ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type Announcements, type DragEndEvent, type ScreenReaderInstructions } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import ActionMenu, { type ActionMenuItem } from "@/components/ActionMenu";
import Icon from "@/components/Icon";

/**
 * A member puts a list of their own things (projects, a project's goals) in the order they like. The pieces:
 * `useReorderableList` keeps the order the member just chose on screen while it saves (and puts the list back, with
 * a message, if the save fails), `SortableList` is the drag area (with spoken announcements for keyboard and screen
 * reader users), and `SortableRow` is one row with its drag handle and its "Move to position" menu.
 */

type Saved = { success: true } | { error: string };

export const HANDLE_TOOLTIP = "Drag to reorder. Keyboard: press Space to pick up, arrow keys to move, Space to drop.";

export function useReorderableList<T extends { id: string }>(items: T[], save: (ids: string[]) => Promise<Saved>, labelOf: (item: T) => string, failure: string, onSaved: () => void) {
  // The order the member just chose, shown at once while it saves. It belongs to the list it was made from: when the page
  // brings a different order or set (after the save, or any other change) it is dropped, and a failed save drops it too.
  const baseKey = items.map((item) => item.id).join(",");
  const [chosen, setChosen] = useState<{ baseKey: string; ids: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const shown =
    chosen && chosen.baseKey === baseKey
      ? chosen.ids.map((id) => items.find((item) => item.id === id)).filter((item): item is T => !!item)
      : items;

  async function reorder(ids: string[]) {
    setChosen({ baseKey, ids });
    setError(null);
    setSaving(true);
    try {
      const result = await save(ids);
      if ("error" in result) throw new Error(result.error);
      onSaved();
    } catch {
      setChosen(null);
      setError(failure);
    } finally {
      setSaving(false);
    }
  }

  /** Moves one item to a 1-based position (the "Move to position" menu). */
  function moveTo(id: string, position: number) {
    const ids = shown.map((item) => item.id);
    const from = ids.indexOf(id);
    const to = Math.min(Math.max(position, 1), ids.length) - 1;
    if (from === -1 || from === to) return;
    const next = arrayMove(ids, from, to);
    const item = shown.find((x) => x.id === id);
    setNote(`${item ? labelOf(item) : "Item"} moved to position ${to + 1} of ${next.length}.`);
    void reorder(next);
  }

  return { shown, saving, error, note, moveTo, reorder };
}

/**
 * The drag area: sensors for mouse, touch (on the handle only) and keyboard, the order a drop ended in, and what
 * a screen reader is told while picking up, moving and dropping an item (by its name, not its id).
 */
export function SortableList({ ids, labels, onReorder, children }: { ids: string[]; labels: Record<string, string>; onReorder: (ids: string[]) => void; children: ReactNode }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onReorder(arrayMove(ids, from, to));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      accessibility={{ announcements: announcementsFor(ids, labels), screenReaderInstructions: SCREEN_READER_INSTRUCTIONS }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

export const SCREEN_READER_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable: "To reorder, press Space to pick up this item. Use the arrow keys to move it, then press Space to drop it, or Escape to cancel.",
};

/** What the live region says during a drag, naming the item and its place in the list (1-based). */
export function announcementsFor(ids: string[], labels: Record<string, string>): Announcements {
  const name = (id: string | number) => labels[String(id)] ?? "Item";
  const place = (id: string | number | undefined) => {
    const at = id === undefined ? -1 : ids.indexOf(String(id));
    return at === -1 ? "" : `position ${at + 1} of ${ids.length}`;
  };
  return {
    onDragStart: ({ active }) => `Picked up ${name(active.id)}. It is at ${place(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${name(active.id)} is now over ${place(over.id)}.` : `${name(active.id)} is no longer over a place in the list.`),
    onDragEnd: ({ active, over }) => (over ? `${name(active.id)} was dropped at ${place(over.id)}.` : `${name(active.id)} was dropped where it started, at ${place(active.id)}.`),
    onDragCancel: ({ active }) => `Reordering cancelled. ${name(active.id)} is back at ${place(active.id)}.`,
  };
}

/**
 * One row. With two or more in the list it has the ordering controls: a drag handle (press and drag it, with a
 * mouse or a finger; Space and the arrow keys work on it too) and a "Move to position" menu.
 *
 * The menu is the alternative to dragging for people who can't drag (WCAG 2.2 criterion 2.5.7, Dragging Movements):
 * pick the place in one step from a list instead of nudging one place at a time. Only the handle captures touch,
 * so swiping anywhere else on the row still scrolls the page.
 *
 * `handle="column"` puts the handle in a column at the row's left, always visible. `handle="cover"` (for a card with
 * a picture at its top left) is the same on a touch screen, but where the pointer really hovers the handle sits over
 * that picture and shows while the row is hovered or has focus inside it. `children` is a function that is given the
 * menu so the row can place it among its own actions.
 */
export function SortableRow({
  id,
  label,
  index,
  count,
  disabled,
  onMoveTo,
  track,
  className,
  idleClassName,
  liftedClassName,
  handle = "column",
  overPicture = false,
  children,
}: {
  id: string;
  label: string;
  index: number;
  count: number;
  disabled: boolean;
  onMoveTo: (position: number) => void;
  /** The prefix of the `data-track` names of the controls, e.g. "projects" gives "projects-drag-handle". */
  track: string;
  /** Classes the row always has; `idleClassName` (its border) when at rest and `liftedClassName` while it is being dragged. */
  className: string;
  idleClassName: string;
  liftedClassName: string;
  handle?: "column" | "cover";
  /** For `handle="cover"`: the row shows a real picture (so the handle is a dark scrim over it on hover) rather than a placeholder icon. */
  overPicture?: boolean;
  children: (menu: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const items: ActionMenuItem[] = Array.from({ length: count }, (_, i) => ({
    key: `pos-${i + 1}`,
    label: i === index ? `Position ${i + 1} (current)` : `Move to position ${i + 1}`,
    disabled: i === index,
    track: `${track}-move-to-position`,
    onSelect: () => onMoveTo(i + 1),
  }));
  const menu =
    count > 1 ? (
      <ActionMenu
        label={`More actions for ${label}`}
        heading={`Move to position (of ${count})`}
        items={items}
        triggerClassName="flex h-11 w-11 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      />
    ) : null;

  const handleButton = (
    <span className={`group/handle relative block ${handle === "cover" ? "[@media(hover:hover)]:h-full [@media(hover:hover)]:w-full" : ""}`}>
      <button
        type="button"
        ref={setActivatorNodeRef}
        data-track={`${track}-drag-handle`}
        aria-label={`Reorder ${label}: press space, then the arrow keys, then space again`}
        {...attributes}
        {...listeners}
        className={`flex touch-none select-none items-center justify-center rounded-md cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-plum-500 ${
          handle === "cover"
            ? // Spelled out in full: Tailwind only finds class names that appear whole in the source. `[@media(hover:hover)]` is a pointer that really hovers.
              `h-11 w-11 [@media(hover:hover)]:h-full [@media(hover:hover)]:w-full [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100 [@media(hover:hover)]:group-focus-within/row:opacity-100 focus-visible:opacity-100 bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 ${
                overPicture
                  ? "[@media(hover:hover)]:bg-black/50 [@media(hover:hover)]:text-white [@media(hover:hover)]:hover:bg-black/60"
                  : "[@media(hover:hover)]:bg-slate-100 [@media(hover:hover)]:hover:bg-slate-200 dark:[@media(hover:hover)]:bg-slate-800 dark:[@media(hover:hover)]:hover:bg-slate-700"
              }`
            : "h-11 w-11 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        }`}
      >
        <Icon name={handle === "cover" ? "grip" : "dots"} className="h-6 w-6" />
      </button>
      <span aria-hidden="true" className="pointer-events-none absolute left-0 top-full z-dropdown mt-1 hidden w-56 rounded-md bg-slate-900 px-2 py-1.5 text-xs text-white shadow-lg group-hover/handle:block group-focus-within/handle:block dark:bg-slate-700">
        {HANDLE_TOOLTIP}
      </span>
    </span>
  );

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} data-sortable-row={id} className={`group/row relative flex gap-3 ${className} ${isDragging ? `z-raised ${liftedClassName}` : idleClassName}`}>
      {count > 1 &&
        (handle === "cover" ? (
          // Where the pointer hovers it overlays the picture (out of the flow, so the row's content keeps its place); on touch it is a column.
          <div className="-ml-2 flex shrink-0 items-center [@media(hover:hover)]:absolute [@media(hover:hover)]:left-5 [@media(hover:hover)]:top-5 [@media(hover:hover)]:ml-0 [@media(hover:hover)]:h-[4.5rem] [@media(hover:hover)]:w-12">{handleButton}</div>
        ) : (
          <div className="-ml-2 flex shrink-0 items-center self-center">{handleButton}</div>
        ))}
      <div className="min-w-0 flex-1">{children(menu)}</div>
    </div>
  );
}
