"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { createProject } from "@/app/(member)/projects/actions";

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const PHASES = [
  { value: "planning", label: "Planning" },
  { value: "drafting", label: "Drafting" },
  { value: "revising", label: "Revising" },
  { value: "on_hold", label: "On hold" },
] as const;

export default function NewProjectModal({ isOpen, onClose, onCreated }: NewProjectModalProps) {
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState<(typeof PHASES)[number]["value"]>("drafting");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Give your project a title");
      return;
    }

    setIsPending(true);
    const result = await createProject(title, phase);
    setIsPending(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }
    setTitle("");
    setPhase("drafting");
    onCreated();
    onClose();
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="New Project" maxWidth="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. The Hedgehog's Journey"
            autoFocus
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Phase</label>
          <select
            value={phase}
            onChange={(e) => setPhase(e.target.value as typeof phase)}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
          >
            {PHASES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? "Creating..." : "Create project"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
