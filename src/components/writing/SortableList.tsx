"use client";

import { useId, useState, type ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type Announcements, type DragEndEvent, type ScreenReaderInstructions } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import ActionMenu, { type ActionMenuItem } from "@/components/ActionMenu";
import Icon from "@/components/Icon";
import { positionItems, positionsHeading } from "@/lib/reorder";
import Tooltip from "@/components/Tooltip";

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
  // dnd-kit numbers its accessibility text ids with a counter that runs on from request to request on the server and starts at zero in the browser, so the server HTML and the first client render disagreed (a hydration mismatch on every page with a list). A React id is the same on both.
  const dndId = useId();
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
      id={dndId}
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
 * The controls get no column of their own (on a phone every pixel of width goes to the title). `children` is a
 * function given the `handle` and the `menu`, so the row places each where it fits. The handle is the shared two-bar
 * `grip` icon: small to look at (20px), with a touch area of 44px by 24px made by an invisible overlap, not by space
 * in the layout. `extraItems` are the row's own actions (Edit, Delete) that the menu carries too, ahead of the positions.
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
  extraItems = [],
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
  /** The row's own actions the menu lists before the positions (each can hide itself where the row shows it inline). */
  extraItems?: ActionMenuItem[];
  children: (controls: { handle: ReactNode; menu: ReactNode }) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const positions = positionItems(count, index, onMoveTo, `${track}-move-to-position`);
  const menu =
    count > 1 ? (
      <ActionMenu
        label={`More actions for ${label}`}
        heading={extraItems.length === 0 ? positionsHeading(count) : undefined}
        items={[...extraItems, ...positions]}
        // A menu holding only the positions gets the reorder icon; one that also holds the row's own actions stays the dots.
        trigger={extraItems.length === 0 ? <Icon name="reorder" /> : undefined}
        tooltip={extraItems.length === 0 ? `More actions for ${label}` : undefined}
        // 32px to look at, 32px wide; the invisible `before` stretches the touch area to 44px tall.
        triggerClassName="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      />
    ) : null;

  const handle =
    count > 1 ? (
      <Tooltip content={HANDLE_TOOLTIP} touchContent="Drag to reorder">
        <button
          type="button"
          ref={setActivatorNodeRef}
          data-track={`${track}-drag-handle`}
          aria-label={`Reorder ${label}: press space, then the arrow keys, then space again`}
          {...attributes}
          {...listeners}
          // One look everywhere: the `grip` icon, no box. `before` makes the touch area 44px tall without taking layout height.
          className="relative flex h-8 w-6 shrink-0 touch-none select-none items-center justify-center rounded-md text-slate-500 cursor-grab before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] hover:bg-slate-100 hover:text-slate-900 active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-plum-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          <Icon name="grip" className="h-5 w-5" />
        </button>
      </Tooltip>
    ) : null;

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} data-sortable-row={id} className={`relative ${className} ${isDragging ? `z-raised ${liftedClassName}` : idleClassName}`}>
      {children({ handle, menu })}
    </div>
  );
}
