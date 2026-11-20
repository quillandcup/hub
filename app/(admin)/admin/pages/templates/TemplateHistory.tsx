"use client";

import { useEffect, useState, useTransition } from "react";
import LifecycleButton from "@/components/LifecycleButton";
import Modal from "@/components/Modal";
import { blockTypeLabel, TEMPLATE_KIND_LABELS } from "@/lib/landing/templates";
import { loadLandingTemplateOutline, loadLandingTemplateVersions, restoreLandingTemplateVersion, type TemplateVersionRow } from "../template-actions";

const SECONDARY = "rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";

/**
 * A template's versions, newest first: who saved each and when, why (the note), and a look inside (block counts by type). **Bring back**
 * makes an earlier version the newest as a NEW version; nothing is lost, every earlier one stays in this list.
 */
export default function TemplateHistory({ template, onClose, onChanged }: { template: { id: string; name: string } | null; onClose: () => void; onChanged: () => void }) {
  const [versions, setVersions] = useState<TemplateVersionRow[] | null>(null);
  const [outlines, setOutlines] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const id = template?.id;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setVersions(null);
    setOutlines({});
    setError(null);
    setMessage(null);
    void loadLandingTemplateVersions(id).then((result) => {
      if (cancelled) return;
      if (result.error || !result.versions) setError(result.error ?? "Couldn't load the history.");
      else setVersions(result.versions);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  function lookInside(versionId: string) {
    setError(null);
    start(async () => {
      const result = await loadLandingTemplateOutline(versionId);
      if (result.error || !result.blocks) return setError(result.error ?? "Couldn't open that version.");
      setOutlines((o) => ({ ...o, [versionId]: result.blocks!.length === 0 ? "Nothing on the page." : result.blocks!.map((b) => `${blockTypeLabel(b.type)} × ${b.count}`).join(", ") }));
    });
  }

  function bringBack(versionId: string) {
    setError(null);
    setMessage(null);
    start(async () => {
      const result = await restoreLandingTemplateVersion(versionId);
      if (result.error) return setError(result.error);
      setMessage(`Brought back as version ${result.version}.`);
      const fresh = id ? await loadLandingTemplateVersions(id) : null;
      if (fresh?.versions) setVersions(fresh.versions);
      onChanged();
    });
  }

  const newest = versions?.[0]?.version;
  return (
    <Modal isOpen={Boolean(template)} onClose={onClose} title={template ? `History of ${template.name}` : "History"} maxWidth="lg">
      <div className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-400">Every save is kept. Bringing a version back makes it the newest one; the versions after it stay here too.</p>
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
        {!versions && !error && <p className="text-sm">Loading…</p>}
        {versions && (
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 space-y-1 text-sm">
                  <p className="font-medium">
                    Version {v.version}
                    {v.version === newest ? " (current)" : ""} · {TEMPLATE_KIND_LABELS[v.kind]}
                  </p>
                  <p className="text-slate-600 dark:text-slate-400">
                    {v.by} · <time dateTime={v.createdAt}>{new Date(v.createdAt).toLocaleString()}</time>
                  </p>
                  {v.note && <p>“{v.note}”</p>}
                  {outlines[v.id] && <p className="text-slate-600 dark:text-slate-400">{outlines[v.id]}</p>}
                </div>
                <div className="flex gap-2">
                  {!outlines[v.id] && (
                    <button type="button" disabled={pending} className={SECONDARY} onClick={() => lookInside(v.id)}>
                      Look inside
                    </button>
                  )}
                  {v.version !== newest && (
                    <LifecycleButton
                      action="restore"
                      noun="version"
                      detail={`Version ${v.version} becomes the template's newest version. Nothing is lost: every version stays in this list.`}
                      disabled={pending}
                      className={SECONDARY}
                      onRun={() => bringBack(v.id)}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
