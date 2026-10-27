"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import FeedbackWidget from "@/components/FeedbackWidget";

/** The help button in the top bar, beside the notification bell: a question mark in a circle that opens a menu with Hedgie Help (the articles) and Send feedback (the feedback form). */
export default function HelpMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const item =
    "block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700";

  return (
    <>
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          data-track="help-menu"
          aria-label="Help"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Help"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" focusable="false">
            <path
              fill="currentColor"
              d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"
            />
          </svg>
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 z-50 mt-2 w-52 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
          >
            <Link href="/help" role="menuitem" data-track="help-menu-help" onClick={() => setMenuOpen(false)} className={item}>
              Hedgie Help
            </Link>
            <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
            <button
              type="button"
              role="menuitem"
              data-track="help-menu-feedback"
              onClick={() => {
                setMenuOpen(false);
                setFeedbackOpen(true);
              }}
              className={item}
            >
              Send feedback
            </button>
          </div>
        )}
      </div>
      <FeedbackWidget open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </>
  );
}
