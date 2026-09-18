"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AliasBadges({ aliases }: { aliases: { id: string; alias: string }[] }) {
  const router = useRouter();
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function handleRemove(id: string) {
    setRemovingId(id);
    try {
      const response = await fetch(`/api/admin/aliases/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to remove alias");
      }
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to remove alias");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {aliases.map((alias) => (
        <span
          key={alias.id}
          className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200"
        >
          {alias.alias}
          <button
            type="button"
            onClick={() => handleRemove(alias.id)}
            disabled={removingId === alias.id}
            aria-label={`Remove alias ${alias.alias}`}
            title="Remove alias"
            className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
