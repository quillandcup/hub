"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { hasCommandModifier, isNativeKeyTarget, isOverlayOpen, isTypingTarget } from "@/lib/keyboard";

/**
 * Keyboard row navigation for a table, driven from the DOM so every table gets it without its own key code.
 * `components/TableKeyboardNav.tsx` is the one place that uses it; read its header for the focus model.
 *
 * Rows are the `tbody > tr` of the region (a row with one full-width cell, such as a date header, and a row marked
 * `data-kbd-skip` are not rows). A row's primary action is its `[data-row-primary]` element (the row itself when the
 * `tr` carries the attribute), else its first link. Its checkbox is the first enabled one inside it.
 */

export interface TableKeyboardPagination {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export interface TableKeyboardCapabilities {
  rows: number;
  open: boolean;
  select: boolean;
  paging: boolean;
}

interface Instance {
  hasRows: () => boolean;
}

/** Mounted tables. With exactly one that has rows, j/k start navigating while nothing has focus (Gmail style). */
const instances = new Set<Instance>();

/** Set when `[`/`]` changed the page, so a table that remounts with the new page's rows (server paging) keeps going. */
let continueUntil = 0;
const CONTINUE_WINDOW_MS = 5000;

const ROW_SELECTOR = "tbody > tr";
const PRIMARY_SELECTOR = "[data-row-primary]";
const CHECKBOX_SELECTOR = 'input[type="checkbox"]:not(:disabled)';
const BODY_KEYS = new Set(["j", "k", "[", "]"]);

function getRows(region: HTMLElement): HTMLElement[] {
  return [...region.querySelectorAll<HTMLTableRowElement>(ROW_SELECTOR)].filter(
    (row) =>
      row.closest("[data-kbd-region]") === region &&
      !row.hasAttribute("data-kbd-skip") &&
      !(row.cells.length === 1 && row.cells[0].colSpan > 1)
  ) as HTMLElement[];
}

function primaryOf(row: HTMLElement): HTMLElement | null {
  if (row.hasAttribute("data-row-primary")) return row;
  return row.querySelector<HTMLElement>(PRIMARY_SELECTOR) ?? row.querySelector<HTMLElement>("a[href]");
}

function checkboxOf(row: HTMLElement): HTMLInputElement | null {
  return row.querySelector<HTMLInputElement>(CHECKBOX_SELECTOR);
}

function pageCountOf(p: TableKeyboardPagination): number {
  return Math.max(1, Math.ceil(p.total / Math.max(1, p.pageSize)));
}

function rowText(row: HTMLElement): string {
  return (row.getAttribute("aria-label") ?? row.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
}

let idCounter = 0;

export function useTableKeyboardNav({
  regionRef,
  pagination,
  resetKey,
  disabled = false,
}: {
  regionRef: RefObject<HTMLElement | null>;
  pagination: TableKeyboardPagination | null | undefined;
  /** Changes when the page, page size or sort changes: the highlight goes back to the first row. */
  resetKey: string;
  disabled?: boolean;
}) {
  const [capabilities, setCapabilities] = useState<TableKeyboardCapabilities>({ rows: 0, open: false, select: false, paging: false });
  const [announcement, setAnnouncement] = useState("");
  const activeRef = useRef<HTMLElement | null>(null);
  // The range being extended with Shift: where it started and where its far end is, as row indexes.
  const rangeRef = useRef<{ anchor: number; head: number } | null>(null);
  const lastResetKey = useRef(resetKey);
  const paginationRef = useRef(pagination);
  useLayoutEffect(() => {
    paginationRef.current = pagination;
  });

  function setActive(region: HTMLElement, rows: HTMLElement[], index: number, announce = true) {
    const row = rows[index];
    if (!row) return;
    if (activeRef.current && activeRef.current !== row) activeRef.current.removeAttribute("data-kbd-active");
    activeRef.current = row;
    row.setAttribute("data-kbd-active", "true");
    if (!row.id) row.id = `kbd-row-${(idCounter += 1)}`;
    region.setAttribute("aria-activedescendant", row.id);
    row.scrollIntoView?.({ block: "nearest" });
    if (announce) {
      const box = checkboxOf(row);
      const state = box ? (box.checked ? ", selected" : ", not selected") : "";
      setAnnouncement(`${rowText(row)}, row ${index + 1} of ${rows.length}${state}`);
    }
  }

  function clearActive(region: HTMLElement) {
    activeRef.current?.removeAttribute("data-kbd-active");
    activeRef.current = null;
    rangeRef.current = null;
    region.removeAttribute("aria-activedescendant");
  }

  // After every render: keep the highlight on a row that still exists, send it back to the first row when the
  // page or sort changed, mirror the checkboxes to aria-selected and work out which hints apply.
  useLayoutEffect(() => {
    const region = regionRef.current;
    if (!region || disabled) return;
    const rows = getRows(region);

    const reset = lastResetKey.current !== resetKey;
    lastResetKey.current = resetKey;
    const continuing = Date.now() < continueUntil && !activeRef.current && rows.length > 0;
    if (rows.length === 0) {
      if (activeRef.current) clearActive(region);
    } else if (continuing) {
      continueUntil = 0;
      setActive(region, rows, 0);
      region.focus({ preventScroll: true });
    } else if (activeRef.current && (reset || !rows.includes(activeRef.current))) {
      rangeRef.current = null;
      continueUntil = 0;
      setActive(region, rows, 0, false);
    }

    let select = false;
    let open = false;
    for (const row of rows) {
      const box = checkboxOf(row);
      if (box) {
        select = true;
        row.setAttribute("aria-selected", String(box.checked));
      }
      if (primaryOf(row)) open = true;
    }
    const pag = paginationRef.current;
    const next = { rows: rows.length, open, select, paging: Boolean(pag && pageCountOf(pag) > 1) };
    setCapabilities((prev) =>
      prev.rows === next.rows && prev.open === next.open && prev.select === next.select && prev.paging === next.paging ? prev : next
    );
  });

  useEffect(() => {
    const region = regionRef.current;
    if (!region || disabled) return;
    const instance: Instance = { hasRows: () => getRows(region).length > 0 };
    instances.add(instance);

    function syncAriaSelected() {
      for (const row of getRows(region!)) {
        const box = checkboxOf(row);
        if (box) row.setAttribute("aria-selected", String(box.checked));
      }
    }
    // A mouse or Tab focus inside a row makes it the highlighted one, so the keys carry on from there.
    function onFocusIn(event: FocusEvent) {
      if (!(event.target instanceof HTMLElement) || event.target === region) return;
      const rows = getRows(region!);
      const row = rows.find((r) => r.contains(event.target as Node));
      if (row && row !== activeRef.current) setActive(region!, rows, rows.indexOf(row), false);
    }

    function select(rows: HTMLElement[], index: number, extend: boolean) {
      const prevIndex = activeRef.current ? rows.indexOf(activeRef.current) : -1;
      const hasBoxes = rows.some((r) => checkboxOf(r));
      if (extend && hasBoxes && prevIndex >= 0) {
        const range = rangeRef.current ?? { anchor: prevIndex, head: prevIndex };
        const lo = Math.min(range.anchor, index);
        const hi = Math.max(range.anchor, index);
        const oldLo = Math.min(range.anchor, range.head);
        const oldHi = Math.max(range.anchor, range.head);
        // Rows the range has left behind are unchecked; every row inside it is checked.
        for (let i = oldLo; i <= oldHi; i++) if (i < lo || i > hi) setChecked(rows[i], false);
        for (let i = lo; i <= hi; i++) setChecked(rows[i], true);
        rangeRef.current = { anchor: range.anchor, head: index };
      } else {
        rangeRef.current = null;
      }
      setActive(region!, rows, index);
    }

    function setChecked(row: HTMLElement | undefined, checked: boolean) {
      const box = row ? checkboxOf(row) : null;
      if (box && box.checked !== checked) box.click();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || hasCommandModifier(event)) return;
      const target = event.target;
      const inRegion = target instanceof Node && region!.contains(target);
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

      let startedFromNothing = false;
      if (!inRegion) {
        if (target !== document.body && target !== document.documentElement) return;
        if (!BODY_KEYS.has(key) || document.querySelector("[data-page-keys]")) return;
        if ([...instances].filter((i) => i.hasRows()).length !== 1 || !instance.hasRows()) return;
        startedFromNothing = true;
      }
      if (isTypingTarget(target) || isOverlayOpen()) return;

      const rows = getRows(region!);
      const current = activeRef.current ? rows.indexOf(activeRef.current) : -1;
      const last = rows.length - 1;
      const handled = () => {
        event.preventDefault();
        if (startedFromNothing) region!.focus({ preventScroll: true });
      };

      switch (key) {
        case "j":
        case "ArrowDown":
          if (rows.length === 0) return;
          handled();
          select(rows, current < 0 ? 0 : Math.min(current + 1, last), event.shiftKey);
          return;
        case "k":
        case "ArrowUp":
          if (rows.length === 0) return;
          handled();
          select(rows, current < 0 ? (key === "k" && startedFromNothing ? last : 0) : Math.max(current - 1, 0), event.shiftKey);
          return;
        case "Home":
        case "End":
          if (rows.length === 0 || isNativeKeyTarget(target)) return;
          handled();
          select(rows, key === "Home" ? 0 : last, false);
          return;
        case "Enter": {
          if (current < 0 || isNativeKeyTarget(target) || event.shiftKey) return;
          const primary = primaryOf(rows[current]);
          if (!primary) return;
          handled();
          primary.click();
          return;
        }
        case " ": {
          if (current < 0 || isNativeKeyTarget(target) || event.shiftKey) return;
          const box = checkboxOf(rows[current]);
          if (!box) return;
          handled();
          rangeRef.current = null;
          box.click();
          setActive(region!, rows, current);
          return;
        }
        case "[":
        case "]": {
          const pag = paginationRef.current;
          if (!pag) return;
          const to = pag.page + (key === "]" ? 1 : -1);
          if (to < 1 || to > pageCountOf(pag)) return;
          handled();
          continueUntil = Date.now() + CONTINUE_WINDOW_MS;
          pag.onPageChange(to);
          return;
        }
      }
    }

    region.addEventListener("focusin", onFocusIn);
    region.addEventListener("change", syncAriaSelected);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      instances.delete(instance);
      region.removeEventListener("focusin", onFocusIn);
      region.removeEventListener("change", syncAriaSelected);
      document.removeEventListener("keydown", onKeyDown);
    };
    // The handlers read everything else through refs and the DOM.
  }, [regionRef, disabled]);

  return { capabilities, announcement };
}
