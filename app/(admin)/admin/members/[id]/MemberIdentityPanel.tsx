"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface NameAliasRow {
  id: string;
  alias: string;
  source: string;
  active: boolean;
}

interface MemberIdentityPanelProps {
  memberId: string;
  name: string;
  displayName: string | null;
  hasKajabiId: boolean;
  nameAliases: NameAliasRow[];
}

function sourceLabel(source: string): string {
  switch (source) {
    case "member":
      return "member added";
    case "admin":
      return "admin added";
    case "zoom":
      return "from Zoom";
    case "slack":
      return "from Slack";
    default:
      return source;
  }
}

export default function MemberIdentityPanel({
  memberId,
  name,
  displayName,
  hasKajabiId,
  nameAliases,
}: MemberIdentityPanelProps) {
  const router = useRouter();
  const [nameInput, setNameInput] = useState(name);
  const [keepOldNameAsPenName, setKeepOldNameAsPenName] = useState(true);
  const [savingName, setSavingName] = useState(false);
  const [penNameInput, setPenNameInput] = useState("");
  const [addingPenName, setAddingPenName] = useState(false);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nameChanged = nameInput.trim() !== name && nameInput.trim().length > 0;

  async function patchMember(body: Record<string, unknown>) {
    const response = await fetch(`/api/admin/members/${memberId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    if (!nameChanged) return;
    setSavingName(true);
    setError(null);
    try {
      await patchMember({ name: nameInput.trim(), keepOldNameAsPenName });
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingName(false);
    }
  }

  async function handleAddPenName(e: React.FormEvent) {
    e.preventDefault();
    if (!penNameInput.trim()) return;
    setAddingPenName(true);
    setError(null);
    try {
      await patchMember({ newPenName: penNameInput.trim() });
      setPenNameInput("");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAddingPenName(false);
    }
  }

  async function handleSetDefault(alias: string | null, id: string) {
    setSettingDefaultId(id);
    setError(null);
    try {
      await patchMember({ displayName: alias });
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSettingDefaultId(null);
    }
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
      <h2 className="text-lg font-bold mb-4">Identity</h2>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-200 text-sm">
          {error}
        </div>
      )}

      <div className="mb-6">
        <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">Legal Name</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          {hasKajabiId
            ? "Changing this updates the contact's name in Kajabi."
            : "This member has no linked Kajabi contact — the name updates locally only."}
        </p>
        <form onSubmit={handleSaveName} className="space-y-2 max-w-md">
          <div className="flex gap-2">
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm"
              maxLength={200}
            />
            <button
              type="submit"
              disabled={savingName || !nameChanged}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savingName ? "Saving…" : "Save"}
            </button>
          </div>
          {nameChanged && (
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
              <input
                type="checkbox"
                checked={keepOldNameAsPenName}
                onChange={(e) => setKeepOldNameAsPenName(e.target.checked)}
              />
              Keep &quot;{name}&quot; as a pen name (and show it to the community by default)
            </label>
          )}
        </form>
      </div>

      <div>
        <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">Pen Names</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          The default pen name is shown to the community instead of the legal name above.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          <button
            onClick={() => handleSetDefault(null, "legal")}
            disabled={settingDefaultId === "legal" || displayName === null}
            className={`px-3 py-1.5 rounded-md border text-sm ${
              displayName === null
                ? "border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            }`}
          >
            {displayName === null ? "Showing legal name" : "Use legal name instead"}
          </button>
          {nameAliases.map((alias) => {
            const isDefault = displayName === alias.alias;
            return (
              <button
                key={alias.id}
                onClick={() => handleSetDefault(alias.alias, alias.id)}
                disabled={settingDefaultId === alias.id || isDefault}
                className={`px-3 py-1.5 rounded-md border text-sm flex items-center gap-2 ${
                  isDefault
                    ? "border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                    : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                } ${!alias.active ? "opacity-50" : ""}`}
              >
                {alias.alias}
                <span className="text-xs text-slate-400 dark:text-slate-500">{sourceLabel(alias.source)}</span>
                {isDefault && <span className="text-xs font-medium">· default</span>}
              </button>
            );
          })}
          {nameAliases.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">No pen names on file yet.</p>
          )}
        </div>
        <form onSubmit={handleAddPenName} className="flex gap-2 max-w-md">
          <input
            type="text"
            value={penNameInput}
            onChange={(e) => setPenNameInput(e.target.value)}
            placeholder="e.g. River Wilde"
            className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm"
            maxLength={200}
          />
          <button
            type="submit"
            disabled={addingPenName || !penNameInput.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {addingPenName ? "Adding…" : "Add"}
          </button>
        </form>
      </div>
    </div>
  );
}
