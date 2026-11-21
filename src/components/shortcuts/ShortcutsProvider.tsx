"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { track } from "@/lib/analytics/client";
import { useHasKeyboard } from "@/lib/hooks/useHasKeyboard";
import { hasCommandModifier, isOverlayOpen, isTypingTarget } from "@/lib/keyboard";
import type { ShortcutGroupId, ShortcutNeed, ShortcutRegistration } from "@/lib/shortcuts";

/**
 * State of the keyboard shortcuts panel, shared by the top bar's Help menu, the `?` key and the panel itself
 * (`ShortcutsPanel`), and the list of page-scoped groups that are on the page right now. Wrap the app shell in it
 * (member and admin layouts). Components outside it (a test, the public pages) are unaffected: every hook is a no-op.
 *
 * Only on a device with a keyboard (`useHasKeyboard`): elsewhere `?` is not listened to and `available` is false.
 */

export type ShortcutsOpenedVia = "key" | "help_menu" | "editor_settings";

interface ShortcutsContextValue {
  available: boolean;
  open: boolean;
  /** Bumps on every open request, so asking again while it is open puts the cursor back in the search box. */
  openRequests: number;
  registrations: readonly ShortcutRegistration[];
  openPanel: (via: ShortcutsOpenedVia, returnTo?: HTMLElement | null) => void;
  closePanel: () => void;
  register: (group: ShortcutGroupId, has: readonly ShortcutNeed[]) => () => void;
}

const ShortcutsContext = createContext<ShortcutsContextValue | null>(null);

export function useShortcutsPanel(): Pick<ShortcutsContextValue, "available" | "open" | "openPanel" | "closePanel"> {
  const context = useContext(ShortcutsContext);
  return context ?? { available: false, open: false, openPanel: () => {}, closePanel: () => {} };
}

/** The panel's own view of the state (not for pages). */
export function useShortcutsState(): ShortcutsContextValue | null {
  return useContext(ShortcutsContext);
}

/**
 * Says "this component's shortcuts are live": the panel lists the group's keys under "On this page" while it is mounted
 * (and `active`). `has` names the optional abilities, for the keys that need them. Without a provider it does nothing.
 */
export function useRegisterShortcuts(group: ShortcutGroupId, { active = true, has = [] }: { active?: boolean; has?: readonly ShortcutNeed[] } = {}): void {
  const register = useContext(ShortcutsContext)?.register;
  const hasKey = has.join(",");
  useEffect(() => {
    if (!register || !active) return;
    return register(group, hasKey ? (hasKey.split(",") as ShortcutNeed[]) : []);
  }, [register, group, active, hasKey]);
}

export default function ShortcutsProvider({ children }: { children: ReactNode }) {
  const available = useHasKeyboard();
  const [open, setOpen] = useState(false);
  const [openRequests, setOpenRequests] = useState(0);
  const [registrations, setRegistrations] = useState<readonly ShortcutRegistration[]>([]);
  const returnTo = useRef<HTMLElement | null>(null);
  const openRef = useRef(false);

  const register = useCallback((group: ShortcutGroupId, has: readonly ShortcutNeed[]) => {
    const registration: ShortcutRegistration = { group, has };
    setRegistrations((current) => [...current, registration]);
    return () => setRegistrations((current) => current.filter((r) => r !== registration));
  }, []);

  const openPanel = useCallback((via: ShortcutsOpenedVia, from?: HTMLElement | null) => {
    if (!openRef.current) {
      const active = document.activeElement;
      returnTo.current = from ?? (active instanceof HTMLElement && active !== document.body ? active : null);
      openRef.current = true;
      track("shortcuts_panel_opened", { via });
    }
    setOpen(true);
    setOpenRequests((n) => n + 1);
  }, []);

  const closePanel = useCallback(() => {
    openRef.current = false;
    setOpen(false);
  }, []);

  // Focus goes back to whatever had it when the panel opened (the Help button, when it was opened from the menu).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) {
      const target = returnTo.current;
      if (target?.isConnected) target.focus();
      returnTo.current = null;
    }
    wasOpen.current = open;
  }, [open]);

  // Shown for a device without a keyboard: nothing to listen to, and a panel left open closes.
  useEffect(() => {
    if (!available && openRef.current) closePanel();
  }, [available, closePanel]);

  useEffect(() => {
    if (!available) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      // Stay out of a dialog's, menu's or list's way: they own the keys while they are on screen.
      if (isOverlayOpen()) return;
      if (event.key === "?" && !hasCommandModifier(event) && !isTypingTarget(event.target)) {
        event.preventDefault();
        if (openRef.current) closePanel();
        else openPanel("key");
      } else if (event.key === "Escape" && openRef.current) {
        closePanel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [available, openPanel, closePanel]);

  const value = useMemo(
    () => ({ available, open: open && available, openRequests, registrations, openPanel, closePanel, register }),
    [available, open, openRequests, registrations, openPanel, closePanel, register],
  );
  return <ShortcutsContext.Provider value={value}>{children}</ShortcutsContext.Provider>;
}
