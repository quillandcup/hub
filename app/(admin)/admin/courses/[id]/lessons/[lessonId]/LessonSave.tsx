"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

interface SaveState {
  dirty: boolean;
  saving: boolean;
  message: { error?: string; saved?: boolean };
}

interface SaveApi extends SaveState {
  /** The lesson text editor says whether it has unsaved changes. */
  setDirty: (dirty: boolean) => void;
  /** The editor hands over what Save should run; it resolves with an error message, or nothing when it worked. */
  setHandler: (handler: (() => Promise<string | null>) | null) => void;
  setMessage: (message: SaveState["message"]) => void;
  save: () => Promise<void>;
}

const NOOP: SaveApi = {
  dirty: false,
  saving: false,
  message: {},
  setDirty: () => {},
  setHandler: () => {},
  setMessage: () => {},
  save: async () => {},
};
const SaveContext = createContext<SaveApi>(NOOP);
export const useLessonSave = () => useContext(SaveContext);

/**
 * Lets the page's header Save button and the lesson text editor share one save: the editor reports whether it has
 * changes and what saving does, the button runs it. (Title, module and status save as they are changed.)
 */
export function LessonSaveProvider({ children }: { children: ReactNode }) {
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<SaveState["message"]>({});
  const handler = useRef<(() => Promise<string | null>) | null>(null);

  const setHandler = useCallback((h: (() => Promise<string | null>) | null) => {
    handler.current = h;
  }, []);

  const save = useCallback(async () => {
    if (!handler.current) return;
    setSaving(true);
    setMessage({});
    try {
      const error = await handler.current();
      if (error) setMessage({ error });
      else {
        setDirty(false);
        setMessage({ saved: true });
      }
    } catch {
      setMessage({ error: "Something went wrong. Refresh the page and try again." });
    } finally {
      setSaving(false);
    }
  }, []);

  const value = useMemo(() => ({ dirty, saving, message, setDirty, setHandler, setMessage, save }), [dirty, saving, message, setHandler, save]);
  return <SaveContext.Provider value={value}>{children}</SaveContext.Provider>;
}

/** The header's Save: on when the lesson text has changes, and says how the save went. */
export function LessonSaveButton() {
  const { dirty, saving, message, save } = useLessonSave();
  return (
    <>
      {message.saved && !dirty && (
        <span role="status" className="text-sm text-slate-600 dark:text-slate-400">
          Saved.
        </span>
      )}
      {message.error && (
        <span role="alert" className="text-sm text-red-700 dark:text-red-300">
          {message.error}
        </span>
      )}
      <button
        type="button"
        data-track="admin-lesson-save"
        onClick={() => void save()}
        disabled={!dirty || saving}
        className="rounded bg-plum-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </>
  );
}
