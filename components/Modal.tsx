"use client";

import { ReactNode, useEffect, useId, useRef } from "react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '5xl';
  /** Nearly the whole screen, with the content filling it (a diagram or canvas that wants the room). */
  fill?: boolean;
}

const maxWidthClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '5xl': 'max-w-5xl',
};

/**
 * Reusable modal component
 * Standardizes modal behavior across the app
 */
export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = '2xl',
  fill = false,
}: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus goes into the dialog when it opens (unless something inside already took it, such as an autofocused
  // field) and back to whatever opened it when it closes.
  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`focus:outline-none bg-white dark:bg-slate-900 rounded-lg shadow-xl w-full overflow-hidden ${
          fill ? "flex h-[94vh] max-w-[96vw] flex-col" : `${maxWidthClasses[maxWidth]} max-h-[80vh]`
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`${fill ? "px-4 py-3" : "p-6"} border-b border-slate-200 dark:border-slate-800`}>
          <div className="flex items-center justify-between gap-4">
            <h3 id={titleId} className="text-xl font-bold flex-1 truncate">{title}</h3>
            <button
              type="button"
              onClick={onClose}
              className="text-2xl leading-none text-slate-500 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-300 flex-shrink-0"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div className={fill ? "min-h-0 flex-1 p-3" : "p-6 overflow-y-auto max-h-[calc(80vh-88px)]"}>
          {children}
        </div>
      </div>
    </div>
  );
}
