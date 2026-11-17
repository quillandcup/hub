"use client";

import { useState, type ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Icon from "@/components/Icon";
import { moveBy } from "@/lib/reorder";

/**
 * A member puts a list of their own things (projects, a project's goals) in the order they like. The pieces:
 * `useReorderableList` keeps the order the member just chose on screen while it saves (and puts the list back, with
 * a message, if the save fails), `SortableList` is the drag area, and `SortableRow` is one row with its grip and its
 * Move up / Move down buttons.
 */

type Saved = { success: true } | { error: string };

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

  function move(id: string, delta: -1 | 1) {
    const ids = shown.map((item) => item.id);
    const next = moveBy(ids, id, delta);
    if (next === ids) return;
    const item = shown.find((x) => x.id === id);
    setNote(`${item ? labelOf(item) : "Item"} moved to position ${next.indexOf(id) + 1} of ${next.length}.`);
    void reorder(next);
  }

  return { shown, saving, error, note, move, reorder };
}

/** The drag area: sensors for mouse, touch (on the grip only) and keyboard, and the order a drop ended in. */
export function SortableList({ ids, onReorder, children }: { ids: string[]; onReorder: (ids: string[]) => void; children: ReactNode }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onReorder(arrayMove(ids, from, to));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

const ORDER_BUTTON =
  "flex h-8 w-11 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30 disabled:hover:bg-transparent dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100";

/**
 * One row. With two or more in the list it has the ordering controls: a grip (press and drag it, with a mouse or a
 * finger; Space and the arrow keys work on it too) and Move up / Move down buttons for anyone who can't drag. Only the
 * grip captures touch, so swiping anywhere else on the row still scrolls the page.
 */
export function SortableRow({
  id,
  label,
  index,
  count,
  disabled,
  onMove,
  track,
  className,
  idleClassName,
  liftedClassName,
  children,
}: {
  id: string;
  label: string;
  index: number;
  count: number;
  disabled: boolean;
  onMove: (delta: -1 | 1) => void;
  /** The prefix of the `data-track` names of the three controls, e.g. "projects" gives "projects-move-up". */
  track: string;
  /** Classes the row always has; `idleClassName` (its border) when at rest and `liftedClassName` while it is being dragged. */
  className: string;
  idleClassName: string;
  liftedClassName: string;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} data-sortable-row={id} className={`relative flex gap-3 ${className} ${isDragging ? `z-raised ${liftedClassName}` : idleClassName}`}>
      {count > 1 && (
        <div className="-ml-2 -my-1 flex shrink-0 flex-col items-center justify-center self-center">
          <button type="button" data-track={`${track}-move-up`} aria-label={`Move ${label} up`} disabled={disabled || index === 0} onClick={() => onMove(-1)} className={ORDER_BUTTON}>
            <Icon name="up" className="h-5 w-5" />
          </button>
          <button
            type="button"
            ref={setActivatorNodeRef}
            data-track={`${track}-drag-handle`}
            aria-label={`Reorder ${label}: press space, then the arrow keys, then space again`}
            {...attributes}
            {...listeners}
            className="flex h-11 w-11 cursor-grab touch-none select-none items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-plum-500 active:cursor-grabbing dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <Icon name="dots" className="h-6 w-6" />
          </button>
          <button type="button" data-track={`${track}-move-down`} aria-label={`Move ${label} down`} disabled={disabled || index === count - 1} onClick={() => onMove(1)} className={ORDER_BUTTON}>
            <Icon name="down" className="h-5 w-5" />
          </button>
        </div>
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
