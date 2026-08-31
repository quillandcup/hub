"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Category = "milestone" | "community" | "course" | "retreat" | "special";

const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: "milestone", label: "Milestone" },
  { value: "community", label: "Community" },
  { value: "course", label: "Course" },
  { value: "retreat", label: "Retreat" },
  { value: "special", label: "Special" },
];

interface LevelInput {
  level: number;
  name: string;
  threshold: string; // kept as string for the input; parsed on submit
}

interface BadgeTypeFormProps {
  mode: "create" | "edit";
  badgeTypeId?: string;
  isAutomatic?: boolean;
  initial?: {
    name: string;
    description: string;
    icon: string;
    category: Category;
    hasLevels: boolean;
    levels: LevelInput[];
  };
}

function emptyLevel(level: number): LevelInput {
  return { level, name: "", threshold: "" };
}

export default function BadgeTypeForm({ mode, badgeTypeId, isAutomatic, initial }: BadgeTypeFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "🏅");
  const [category, setCategory] = useState<Category>(initial?.category ?? "community");
  const [hasLevels, setHasLevels] = useState(initial?.hasLevels ?? false);
  const [levels, setLevels] = useState<LevelInput[]>(
    initial?.levels && initial.levels.length > 0 ? initial.levels : [emptyLevel(1)]
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addLevel = () => setLevels((prev) => [...prev, emptyLevel(prev.length + 1)]);
  const removeLevel = (index: number) =>
    setLevels((prev) => prev.filter((_, i) => i !== index).map((l, i) => ({ ...l, level: i + 1 })));
  const updateLevel = (index: number, patch: Partial<LevelInput>) =>
    setLevels((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        icon: icon.trim(),
        category,
        hasLevels,
        levels: hasLevels
          ? levels.map((l) => ({
              level: l.level,
              name: l.name.trim(),
              threshold: l.threshold.trim() === "" ? null : Number(l.threshold),
            }))
          : [],
      };

      const url = mode === "create" ? "/api/badge-types/create" : `/api/badge-types/${badgeTypeId}/update`;
      const method = mode === "create" ? "POST" : "PATCH";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Failed to ${mode === "create" ? "create" : "update"} badge`);
      }

      router.push("/admin/badges");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
      <h2 className="text-xl font-bold mb-6">{mode === "create" ? "New Badge" : "Edit Badge"}</h2>

      {isAutomatic && (
        <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-blue-800 dark:text-blue-200 text-sm">
          This badge is computed automatically (see lib/badges.ts) — you can rename it or adjust
          its levels/thresholds, but it can&apos;t be manually awarded to a member.
        </div>
      )}

      {error && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-[1fr_auto] gap-4 mb-6">
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Hedgie Mentor"
              className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              required
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">Icon</label>
            <input
              type="text"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="🏅"
              className="w-20 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-center text-lg"
              maxLength={4}
            />
          </div>
        </div>

        <div className="mb-6">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">
            Description (optional)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Shown as a tooltip on the badge..."
            rows={2}
            className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          />
        </div>

        <div className="mb-6">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
            className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          >
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-6">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={hasLevels}
              onChange={(e) => setHasLevels(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-600"
            />
            Has levels (e.g. Bronze/Silver/Gold, or 1x/5x/10x)
          </label>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Each time a member is awarded this badge, it counts as one occurrence. Their displayed
            level is the highest threshold their occurrence count has reached.
          </p>
        </div>

        {hasLevels && (
          <div className="mb-6 space-y-3">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">
              Levels (lowest to highest)
            </label>
            {levels.map((level, index) => (
              <div key={index} className="flex items-center gap-3">
                <span className="text-xs text-slate-500 dark:text-slate-400 w-6">#{level.level}</span>
                <input
                  type="text"
                  value={level.name}
                  onChange={(e) => updateLevel(index, { name: e.target.value })}
                  placeholder="e.g., 5x Hostess"
                  className="flex-1 px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm"
                  required
                />
                <input
                  type="number"
                  value={level.threshold}
                  onChange={(e) => updateLevel(index, { threshold: e.target.value })}
                  placeholder="Threshold"
                  min={1}
                  className="w-28 px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm"
                  required
                />
                <button
                  type="button"
                  onClick={() => removeLevel(index)}
                  disabled={levels.length === 1}
                  className="text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addLevel}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              + Add level
            </button>
          </div>
        )}

        <div className="flex gap-4">
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium transition-colors"
          >
            {loading ? "Saving..." : mode === "create" ? "Create Badge" : "Save Changes"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/admin/badges")}
            disabled={loading}
            className="px-6 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:bg-slate-300 text-slate-700 dark:text-slate-300 rounded-lg font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
