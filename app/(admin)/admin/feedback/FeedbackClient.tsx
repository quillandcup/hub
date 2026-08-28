"use client";

import { useCallback, useEffect, useState } from "react";
import { startSudo } from "@/app/actions/sudo";

type FeedbackType = "bug" | "data" | "idea";
type Status = "new" | "acknowledged" | "resolved" | "wontfix";

interface FeedbackItem {
  id: string;
  created_at: string;
  user_id: string;
  is_sudo: boolean;
  page_url: string;
  feedback_type: FeedbackType;
  message: string;
  status: Status;
  admin_notes: string | null;
  submitter_email: string | null;
  screenshot_url: string | null;
  member_id: string | null;
  member: { name: string; email: string } | null;
}

const TYPE_LABELS: Record<FeedbackType, string> = {
  bug: "🐛 Bug",
  data: "📊 Data",
  idea: "💡 Idea",
};

const STATUS_LABELS: Record<Status, string> = {
  new: "New",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
  wontfix: "Won't fix",
};

const STATUS_COLORS: Record<Status, string> = {
  new: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  acknowledged: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  resolved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  wontfix: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
};

export default function FeedbackClient() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<Status | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/admin/feedback?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load feedback");
      setItems(data.items);
      setTotal(data.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load feedback");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!lightbox) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setLightbox(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightbox]);

  async function updateStatus(id: string, status: Status) {
    setSavingId(id);
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status } : it)));
    try {
      const res = await fetch(`/api/admin/feedback/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update status");
    } catch (err) {
      console.error(err);
      await load();
    } finally {
      setSavingId(null);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Feedback</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Bugs, data issues, and ideas submitted from the feedback widget
        </p>
      </div>

      <div className="mb-4 flex gap-2">
        {(["", "new", "acknowledged", "resolved", "wontfix"] as const).map((s) => (
          <button
            key={s || "all"}
            onClick={() => {
              setPage(0);
              setStatusFilter(s);
            }}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
              statusFilter === s
                ? "bg-blue-600 text-white"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
            }`}
          >
            {s ? STATUS_LABELS[s] : "All"}
          </button>
        ))}
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-xl font-bold">
            {loading ? "Loading..." : `${total} item${total === 1 ? "" : "s"}`}
          </h2>
        </div>

        {error && <div className="p-6 text-red-600 dark:text-red-400">{error}</div>}

        {!loading && !error && (
          <div className="divide-y divide-slate-200 dark:divide-slate-700">
            {items.length === 0 && (
              <div className="p-6 text-sm text-slate-500 dark:text-slate-400">
                No feedback yet.
              </div>
            )}
            {items.map((item) => (
              <div key={item.id} className="p-6 flex gap-4">
                {item.screenshot_url ? (
                  <button onClick={() => setLightbox(item.screenshot_url)} className="flex-shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.screenshot_url}
                      alt="Feedback screenshot"
                      className="w-32 h-20 object-cover object-top rounded border border-slate-200 dark:border-slate-700"
                    />
                  </button>
                ) : (
                  <div className="w-32 h-20 flex-shrink-0 flex items-center justify-center rounded border border-dashed border-slate-200 dark:border-slate-700 text-xs text-slate-400">
                    No screenshot
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm font-medium">{TYPE_LABELS[item.feedback_type]}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {item.member?.name ?? item.submitter_email ?? item.user_id}
                      {item.is_sudo && " (via sudo)"}
                    </span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      {new Date(item.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap mb-2">
                    {item.message}
                  </p>
                  <a
                    href={item.page_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline break-all"
                  >
                    {item.page_url}
                  </a>
                </div>

                <div className="flex-shrink-0 flex flex-col items-end gap-2">
                  <select
                    value={item.status}
                    disabled={savingId === item.id}
                    onChange={(e) => updateStatus(item.id, e.target.value as Status)}
                    className={`text-xs px-2 py-1 rounded-full font-medium border-0 ${STATUS_COLORS[item.status]}`}
                  >
                    {(Object.keys(STATUS_LABELS) as Status[]).map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                  {item.member_id && (
                    <form action={startSudo.bind(null, item.member_id, item.page_url)}>
                      <button
                        type="submit"
                        className="text-xs px-2 py-1 rounded-full font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-700 hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors whitespace-nowrap"
                      >
                        Sudo as reporter
                      </button>
                    </form>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {pageCount > 1 && (
          <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-sm">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-40 disabled:no-underline"
            >
              ← Newer
            </button>
            <span className="text-slate-500 dark:text-slate-400">
              Page {page + 1} of {pageCount}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1}
              className="text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-40 disabled:no-underline"
            >
              Older →
            </button>
          </div>
        )}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-8"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="Feedback screenshot" className="max-w-full max-h-full rounded shadow-2xl" />
        </div>
      )}
    </div>
  );
}
