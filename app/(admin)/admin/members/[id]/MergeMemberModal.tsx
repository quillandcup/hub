"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import type { MemberExternalStatus } from "@/app/api/admin/members/external-status/route";

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
  const [primaryId, setPrimaryId] = useState<string>(primaryMember.id);
  const [loading, setLoading] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<{ field: string; kept: string; discarded: string }[]>([]);
  const [externalStatus, setExternalStatus] = useState<MemberExternalStatus | null>(null);
  const [externalLoading, setExternalLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derive primary and secondary from the two members + chosen primaryId
  const primary = selectedSecondary
    ? ([primaryMember, selectedSecondary].find(m => m.id === primaryId) ?? primaryMember)
    : primaryMember;
  const secondary = selectedSecondary
    ? ([primaryMember, selectedSecondary].find(m => m.id !== primaryId) ?? null)
    : null;

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setResults([]);
      setSelectedSecondary(null);
      setPrimaryId(primaryMember.id);
      setError(null);
      setConflicts([]);
      setExternalStatus(null);
    }
  }, [isOpen, primaryMember.id]);

  // Check external accounts for the secondary (non-primary) member
  const secondaryId = secondary?.id;
  useEffect(() => {
    if (!secondaryId) { setExternalStatus(null); return; }
    setExternalLoading(true);
    fetch(`/api/admin/members/external-status?ids=${secondaryId}`)
      .then(r => r.json())
      .then(data => setExternalStatus(data.members?.[secondaryId] ?? null))
      .catch(() => setExternalStatus(null))
      .finally(() => setExternalLoading(false));
  }, [secondaryId]);

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
        // Exclude the page member from results
        setResults((json.members || []).filter((m: Member) => m.id !== primaryMember.id));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, [query, primaryMember.id]);

  async function handleMerge() {
    if (!secondary) return;
    setMerging(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/members/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryId: primary.id, secondaryId: secondary.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Merge failed");
      if (json.conflicts?.length) {
        setConflicts(json.conflicts);
        router.refresh();
        return;
      }
      onClose();
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setMerging(false);
    }
  }

  function handleSelectSecondary(m: Member) {
    setSelectedSecondary(m);
    setPrimaryId(primaryMember.id);
    setQuery("");
    setResults([]);
  }

  function handleChangeSecondary() {
    setSelectedSecondary(null);
    setPrimaryId(primaryMember.id);
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Merge Duplicate Members" maxWidth="lg">
      <div className="space-y-5">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Search for the duplicate member to merge. Once selected, choose which one to keep as
          primary. All attendance, activities, and aliases will be transferred to the primary. The
          duplicate will be permanently deleted.
        </p>

        {selectedSecondary ? (
          /* Radio selection + absorb display */
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
                Select primary (keep)
              </p>
              <div className="space-y-2">
                {[primaryMember, selectedSecondary].map((m) => (
                  <label
                    key={m.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                      primaryId === m.id
                        ? "border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-950/30"
                        : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                    }`}
                  >
                    <input
                      type="radio"
                      name="primary"
                      value={m.id}
                      checked={primaryId === m.id}
                      onChange={() => setPrimaryId(m.id)}
                      className="accent-blue-600"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{m.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{m.email}</p>
                    </div>
                    {primaryId === m.id && (
                      <span className="ml-auto text-xs font-medium text-blue-600 dark:text-blue-400 flex-shrink-0">Keep</span>
                    )}
                  </label>
                ))}
              </div>
            </div>

            {secondary && (
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                  Absorb & delete (duplicate)
                </p>
                <div className="flex items-center gap-3 p-3 rounded-lg border-2 border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-950/30">
                  <div className="w-9 h-9 rounded-full bg-red-200 dark:bg-red-800 flex items-center justify-center text-sm font-semibold text-red-700 dark:text-red-300 flex-shrink-0">
                    {secondary.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{secondary.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{secondary.email}</p>
                  </div>
                  <button
                    onClick={handleChangeSecondary}
                    className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex-shrink-0"
                  >
                    Change
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Original static primary + search for secondary */
          <>
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
                        onClick={() => handleSelectSecondary(m)}
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
            </div>
          </>
        )}

        {/* What will happen */}
        {secondary && (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-700 p-3 text-xs text-amber-800 dark:text-amber-300 space-y-1">
            <p className="font-semibold">What will happen:</p>
            <ul className="list-disc list-inside space-y-0.5 text-amber-700 dark:text-amber-400">
              <li>All attendance records transferred to {primary.name}</li>
              <li>All activities, hiatuses, and aliases transferred</li>
              <li>
                <strong>{secondary.email}</strong> added as an email alias so future imports
                still resolve correctly
              </li>
              {secondary.name !== primary.name && (
                <li>
                  <strong>{secondary.name}</strong> added as a name alias for Zoom matching
                </li>
              )}
              <li className="font-semibold">
                {secondary.name} ({secondary.email}) permanently deleted
              </li>
            </ul>
          </div>
        )}

        {externalLoading && secondary && (
          <p className="text-xs text-slate-500 dark:text-slate-400">Checking external accounts...</p>
        )}

        {!externalLoading && externalStatus && secondary && hasExternalAccounts(externalStatus) && (
          <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-700 p-3 text-xs space-y-1">
            <p className="font-semibold text-red-800 dark:text-red-300 mb-2">
              External accounts require manual cleanup after merging:
            </p>
            <ExternalAccountWarnings member={secondary} status={externalStatus} />
          </div>
        )}

        {conflicts.length > 0 && (
          <div className="rounded-lg bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-700 p-3 text-xs space-y-1">
            <p className="font-semibold text-orange-800 dark:text-orange-300">Merge complete — ID conflicts detected:</p>
            <ul className="list-disc list-inside space-y-0.5 text-orange-700 dark:text-orange-400">
              {conflicts.map((c) => (
                <li key={c.field}>
                  <strong>{c.field}</strong>: kept <code>{c.kept}</code>, discarded <code>{c.discarded}</code>
                </li>
              ))}
            </ul>
            <p className="text-orange-600 dark:text-orange-500 mt-1">
              Both members had different external IDs. The primary&apos;s values were kept. Verify in Kajabi/Stripe if needed.
            </p>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="flex justify-end gap-3 pt-1">
          {conflicts.length > 0 ? (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={handleMerge}
                disabled={!secondary || merging}
                className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 disabled:bg-red-300 dark:disabled:bg-red-900 text-white rounded-lg transition-colors"
              >
                {merging ? "Merging..." : "Merge & Delete Duplicate"}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function hasExternalAccounts(status: MemberExternalStatus): boolean {
  return !!(status.kajabi_id || status.stripe_customer_id || status.slack_user_id);
}

function ExternalAccountWarnings({ member, status }: { member: { name: string; email: string }; status: MemberExternalStatus }) {
  return (
    <div>
      <p className="font-semibold text-red-700 dark:text-red-400 mb-1">
        {member.name} <span className="font-normal text-red-600 dark:text-red-500">({member.email})</span>
      </p>
      <ul className="space-y-1 ml-2">
        {status.kajabi_id && (
          <li className="flex items-start gap-1.5">
            <span className="text-red-400 mt-0.5">•</span>
            <span className={status.kajabi_active_purchases > 0 ? "text-red-700 dark:text-red-400" : "text-slate-600 dark:text-slate-400"}>
              {status.kajabi_active_purchases > 0
                ? "Active Kajabi subscription — cancel or migrate before merging"
                : "Kajabi account — verify course access in Kajabi"}
              {" "}
              <a
                href={`https://app.kajabi.com/admin/contacts/${status.kajabi_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                {status.kajabi_id} ↗
              </a>
            </span>
          </li>
        )}
        {status.stripe_customer_id && (
          <li className="flex items-start gap-1.5">
            <span className="text-red-400 mt-0.5">•</span>
            <span className={status.stripe_active_subscriptions > 0 ? "text-red-700 dark:text-red-400" : "text-slate-600 dark:text-slate-400"}>
              {status.stripe_active_subscriptions > 0
                ? `${status.stripe_active_subscriptions} active Stripe subscription${status.stripe_active_subscriptions !== 1 ? "s" : ""} — cancel or migrate before merging`
                : "Stripe account — no active subscriptions"}
              {" "}
              <a
                href={`https://dashboard.stripe.com/customers/${status.stripe_customer_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                {status.stripe_customer_id} ↗
              </a>
            </span>
          </li>
        )}
        {status.slack_user_id && (
          <li className="flex items-start gap-1.5">
            <span className="text-slate-400 mt-0.5">•</span>
            <span className="text-slate-600 dark:text-slate-400">
              Slack account ({status.slack_user_id}) — message history resolves automatically via email alias
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}
