"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";

interface Member {
  id: string;
  name: string;
  email: string;
}

interface MergeMemberModalProps {
  primaryMember: Member;
  isOpen: boolean;
  onClose: () => void;
}

export default function MergeMemberModal({ primaryMember, isOpen, onClose }: MergeMemberModalProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Member[]>([]);
  const [selectedSecondary, setSelectedSecondary] = useState<Member | null>(null);
  const [loading, setLoading] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setResults([]);
      setSelectedSecondary(null);
      setError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/members?search=${encodeURIComponent(query.trim())}`);
        const json = await res.json();
        // Exclude the primary member from results
        setResults((json.members || []).filter((m: Member) => m.id !== primaryMember.id));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, [query, primaryMember.id]);

  async function handleMerge() {
    if (!selectedSecondary) return;
    setMerging(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/members/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryId: primaryMember.id, secondaryId: selectedSecondary.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Merge failed");
      onClose();
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setMerging(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Merge Duplicate Members" maxWidth="lg">
      <div className="space-y-5">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Search for the duplicate member to absorb into <strong>{primaryMember.name}</strong>. All
          attendance, activities, and aliases will be transferred to the primary. The duplicate will
          be permanently deleted.
        </p>

        {/* Primary */}
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
            Keep (primary)
          </p>
          <div className="flex items-center gap-3 p-3 rounded-lg border-2 border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/30">
            <div className="w-9 h-9 rounded-full bg-blue-200 dark:bg-blue-800 flex items-center justify-center text-sm font-semibold text-blue-700 dark:text-blue-300 flex-shrink-0">
              {primaryMember.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="font-medium text-sm truncate">{primaryMember.name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{primaryMember.email}</p>
            </div>
          </div>
        </div>

        {/* Secondary search */}
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
            Absorb & delete (duplicate)
          </p>
          {selectedSecondary ? (
            <div className="flex items-center gap-3 p-3 rounded-lg border-2 border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-950/30">
              <div className="w-9 h-9 rounded-full bg-red-200 dark:bg-red-800 flex items-center justify-center text-sm font-semibold text-red-700 dark:text-red-300 flex-shrink-0">
                {selectedSecondary.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm truncate">{selectedSecondary.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{selectedSecondary.email}</p>
              </div>
              <button
                onClick={() => setSelectedSecondary(null)}
                className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex-shrink-0"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name or email..."
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
              {loading && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {results.length > 0 && (
                <div className="mt-1 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden shadow-lg bg-white dark:bg-slate-900">
                  {results.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => { setSelectedSecondary(m); setQuery(""); setResults([]); }}
                      className="w-full text-left px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800 border-b border-slate-100 dark:border-slate-800 last:border-0 transition-colors"
                    >
                      <p className="text-sm font-medium">{m.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{m.email}</p>
                    </button>
                  ))}
                </div>
              )}
              {query.trim().length >= 2 && !loading && results.length === 0 && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">No members found</p>
              )}
            </div>
          )}
        </div>

        {/* What will happen */}
        {selectedSecondary && (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-700 p-3 text-xs text-amber-800 dark:text-amber-300 space-y-1">
            <p className="font-semibold">What will happen:</p>
            <ul className="list-disc list-inside space-y-0.5 text-amber-700 dark:text-amber-400">
              <li>All attendance records transferred to {primaryMember.name}</li>
              <li>All activities, hiatuses, and aliases transferred</li>
              <li>
                <strong>{selectedSecondary.email}</strong> added as an email alias so future imports
                still resolve correctly
              </li>
              {selectedSecondary.name !== primaryMember.name && (
                <li>
                  <strong>{selectedSecondary.name}</strong> added as a name alias for Zoom matching
                </li>
              )}
              <li className="font-semibold">
                {selectedSecondary.name} ({selectedSecondary.email}) permanently deleted
              </li>
            </ul>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="flex justify-end gap-3 pt-1">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
          >
            Cancel
          </button>
          <button
            onClick={handleMerge}
            disabled={!selectedSecondary || merging}
            className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 disabled:bg-red-300 dark:disabled:bg-red-900 text-white rounded-lg transition-colors"
          >
            {merging ? "Merging..." : "Merge & Delete Duplicate"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
