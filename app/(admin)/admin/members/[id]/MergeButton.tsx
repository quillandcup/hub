"use client";

import { useState } from "react";
import MergeMemberModal from "./MergeMemberModal";

interface MergeButtonProps {
  member: { id: string; name: string; email: string };
}

export default function MergeButton({ member }: MergeButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1 text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
      >
        Merge
      </button>
      <MergeMemberModal primaryMember={member} isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}
