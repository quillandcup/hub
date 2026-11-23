"use client";

import { useRef, useState } from "react";
import Modal from "@/components/Modal";
import ImportKajabiRow from "./ImportKajabiRow";

const INPUT = "w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const SECONDARY = "rounded border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800";

/**
 * Import from Kajabi (docs/product/LANDING_PAGES.md, "Importing from Kajabi"): one or several page exports. Each file is its
 * own row (`ImportKajabiRow`): it is read first, shows what it starts with, and gets its own title and its own choice
 * between a new page and replacing a page's draft.
 */
export default function ImportKajabiDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<{ key: number; file: File }[]>([]);
  const next = useRef(0);

  const close = () => {
    setRows([]);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={close} title="Import from Kajabi" maxWidth="2xl">
      <div className="max-h-[60vh] space-y-4 overflow-y-auto text-sm">
        <p>
          Upload one or more Kajabi page exports (the zip from a page&apos;s Export). Each becomes a draft here; nothing goes live until you publish. The export has no page title, so each file shows what it starts with, to tell them apart, and suggests a title.
        </p>
        <label className="block font-medium">
          Export files
          <input
            type="file"
            multiple
            accept=".zip,application/zip"
            onChange={(e) => {
              const chosen = Array.from(e.target.files ?? []);
              e.target.value = "";
              setRows((current) => [...current, ...chosen.map((file) => ({ key: next.current++, file }))]);
            }}
            className={`${INPUT} mt-1`}
          />
        </label>
        {rows.map((row) => (
          <ImportKajabiRow key={row.key} file={row.file} onRemove={() => setRows((current) => current.filter((r) => r.key !== row.key))} />
        ))}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className={SECONDARY}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
