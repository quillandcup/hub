"use client";

import { createContext, useCallback, useContext, useRef, useState, useTransition, type ReactNode } from "react";
import { setLessonComplete } from "./actions";

/** A lesson counts as watched once the playhead passes this fraction of the video (Kajabi's "about 90%"). */
export const AUTO_COMPLETE_FRACTION = 0.9;

interface LessonCompletion {
  completed: boolean;
  /** Why it can't be changed (sudo, or a staff preview); null when it can. */
  readOnlyReason: string | null;
  error: string | null;
  pending: boolean;
  /** The member pressed the button: sets or clears completion. */
  toggle: () => void;
  /** The player reached the watched mark: completes it, once, unless the member has chosen otherwise. */
  autoComplete: () => void;
}

const Context = createContext<LessonCompletion | null>(null);

/**
 * One lesson's completion, shared by the player (which completes it at ~90%), the Mark complete button
 * and the next-lesson card, so they agree without a round trip. Updates straight away and tells the
 * server (the action checks access itself); a refusal puts it back and shows why. Read-only (sudo, a
 * staff preview) changes nothing.
 */
export function LessonCompletionProvider({
  lessonId,
  initiallyCompleted,
  readOnlyReason,
  children,
}: {
  lessonId: string;
  initiallyCompleted: boolean;
  readOnlyReason: string | null;
  children: ReactNode;
}) {
  const [completed, setCompleted] = useState(initiallyCompleted);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Once the member has pressed the button, watching on never completes it behind their back.
  const decidedByMember = useRef(false);
  const autoDone = useRef(false);

  const apply = useCallback(
    (next: boolean) => {
      setCompleted(next);
      setError(null);
      startTransition(async () => {
        const result = await setLessonComplete(lessonId, next);
        if (result.error) {
          setCompleted(!next);
          setError(result.error);
        }
      });
    },
    [lessonId]
  );

  const toggle = useCallback(() => {
    if (readOnlyReason) return;
    decidedByMember.current = true;
    apply(!completed);
  }, [apply, completed, readOnlyReason]);

  const autoComplete = useCallback(() => {
    if (readOnlyReason || completed || autoDone.current || decidedByMember.current) return;
    autoDone.current = true;
    apply(true);
  }, [apply, completed, readOnlyReason]);

  return <Context.Provider value={{ completed, readOnlyReason, error, pending, toggle, autoComplete }}>{children}</Context.Provider>;
}

/** The lesson's completion state, or null outside a provider (the player then just plays). */
export function useLessonCompletion(): LessonCompletion | null {
  return useContext(Context);
}
