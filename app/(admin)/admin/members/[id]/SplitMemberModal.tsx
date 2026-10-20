"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import type { EmailAliasRow, NameAliasRow } from "./MemberIdentityPanel";

interface SplitMemberModalProps {
  member: { id: string; name: string; email: string };
  nameAliases: NameAliasRow[];
  emailAliases: EmailAliasRow[];
  isOpen: boolean;
  onClose: () => void;
}

export default function SplitMemberModal({ member, nameAliases, emailAliases, isOpen, onClose }: SplitMemberModalProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [nameIds, setNameIds] = useState<Set<string>>(new Set());
  const [emailIds, setEmailIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(set: Set<string>, id: string, update: (next: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  }

  // Ticking an alias fills its field when still empty, so the details usually come from the aliases.
  function toggleName(row: NameAliasRow) {
    toggle(nameIds, row.id, setNameIds);
    if (!nameIds.has(row.id) && !name) setName(row.alias);
  }

  function toggleEmail(row: EmailAliasRow) {
    toggle(emailIds, row.id, setEmailIds);
    if (!emailIds.has(row.id) && !email) setEmail(row.alias_email);
  }

  async function handleSplit() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/members/split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: member.id,
          name,
          email,
          nameAliasIds: [...nameIds],
          emailAliasIds: [...emailIds],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Split failed");
      onClose();
      router.push(`/admin/members/${json.memberId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Split failed");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-plum-500";

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Split Out a Merged Member" maxWidth="lg">
      <div className="space-y-5">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Use this when {member.name} was merged with someone who is a different person. Tick the names and emails
          below that are theirs (the first ones ticked fill in the fields, which you can edit). A new member is
          created with those, and Zoom attendance is re-filed under whoever each name or email matches now.
        </p>

        <div className="space-y-3">
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            New member name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={`${inputClass} mt-1.5 normal-case`} />
          </label>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            New member email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputClass} mt-1.5 normal-case`} />
          </label>
        </div>

        {nameAliases.length > 0 && (
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
              Names that belong to the new member
            </legend>
            {nameAliases.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={nameIds.has(a.id)} onChange={() => toggleName(a)} className="accent-plum-600" />
                {a.alias}
              </label>
            ))}
          </fieldset>
        )}

        {emailAliases.length > 0 && (
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
              Emails that belong to the new member
            </legend>
            {emailAliases.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={emailIds.has(a.id)} onChange={() => toggleEmail(a)} className="accent-plum-600" />
                {a.alias_email}
              </label>
            ))}
          </fieldset>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-3 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">
            Cancel
          </button>
          <button
            onClick={handleSplit}
            disabled={!name.trim() || !email.trim() || saving}
            className="px-4 py-2 text-sm font-medium bg-plum-600 hover:bg-plum-700 disabled:bg-plum-300 text-white rounded-lg transition-colors"
          >
            {saving ? "Splitting..." : "Split into new member"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
