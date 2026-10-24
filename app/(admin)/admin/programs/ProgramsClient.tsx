"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { SortableTh } from "@/components/SortableTh";
import { useDataTable } from "@/lib/hooks/useDataTable";
import type { SortValue } from "@/lib/hooks/useTableSort";
import { DataTablePager } from "@/components/DataTablePager";

interface Program {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  includes_membership: boolean;
  cohort_count: number;
  enrollment_count: number;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

type SortColumn = "name" | "cohorts" | "enrollments";

function getSortValue(program: Program, column: SortColumn): SortValue {
  switch (column) {
    case "name":
      return program.name.toLowerCase();
    case "cohorts":
      return program.cohort_count;
    case "enrollments":
      return program.enrollment_count;
  }
}

export default function ProgramsClient() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({ name: "", description: "", includes_membership: true });
  const table = useDataTable<Program, SortColumn>({
    rows: programs,
    getSortValue,
    defaultSort: null,
  });
  const { sortColumn, sortDirection, handleSort } = table;

  const fetchPrograms = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/admin/programs");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to fetch programs");
      setPrograms(data.programs);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrograms();
  }, [fetchPrograms]);


  // Whether joining the program makes someone a member, so they get a Big Sister.
  const setIncludesMembership = async (program: Program, includes: boolean) => {
    setError(null);
    try {
      const response = await fetch(`/api/admin/programs/${program.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includes_membership: includes }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to update program");
      fetchPrograms();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const response = await fetch("/api/admin/programs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          slug: slugify(formData.name),
          description: formData.description || null,
          includes_membership: formData.includes_membership,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to create program");
      setShowForm(false);
      setFormData({ name: "", description: "", includes_membership: true });
      fetchPrograms();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-slate-500">Loading...</p>;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded text-sm text-red-800 dark:text-red-300">
          {error}
        </div>
      )}

      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="mb-4 px-4 py-2 bg-plum-600 text-white rounded hover:bg-plum-700"
        >
          Add Program
        </button>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-6 p-4 border border-gray-200 dark:border-slate-700 rounded bg-gray-50 dark:bg-slate-800 space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-200">Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded"
              placeholder="e.g., Self-Editing Academy"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-200">Description (optional)</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded"
              rows={2}
            />
          </div>
          <label className="flex items-start gap-2 text-sm dark:text-gray-200">
            <input
              type="checkbox"
              checked={formData.includes_membership}
              onChange={(e) => setFormData({ ...formData, includes_membership: e.target.checked })}
              className="mt-1"
            />
            <span>
              Includes membership
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                Joining makes someone a member, so they get a Big Sister. Leave off for a course that doesn&apos;t include
                membership.
              </span>
            </span>
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="px-4 py-2 bg-plum-600 text-white rounded hover:bg-plum-700 disabled:opacity-50">
              {saving ? "Saving..." : "Create Program"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 bg-gray-300 dark:bg-slate-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-400 dark:hover:bg-slate-600"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="border border-gray-200 dark:border-slate-700 rounded overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-slate-800">
            <tr>
              <SortableTh
                label="Program"
                active={sortColumn === "name"}
                direction={sortDirection}
                onClick={() => handleSort("name")}
              />
              <SortableTh
                label="Cohorts"
                active={sortColumn === "cohorts"}
                direction={sortDirection}
                onClick={() => handleSort("cohorts")}
              />
              <SortableTh
                label="Enrollments"
                active={sortColumn === "enrollments"}
                direction={sortDirection}
                onClick={() => handleSort("enrollments")}
              />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Includes membership
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-slate-800">
            {programs.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                  No programs found.
                </td>
              </tr>
            ) : (
              table.rows.map((program) => (
                <tr key={program.id} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/programs/${program.id}`}
                      className="font-medium text-plum-600 dark:text-plum-400 hover:underline"
                    >
                      {program.name}
                    </Link>
                    {program.description && (
                      <div className="text-sm text-gray-600 dark:text-gray-400">{program.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">{program.cohort_count}</td>
                  <td className="px-4 py-3 text-sm">{program.enrollment_count}</td>
                  <td className="px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      checked={program.includes_membership}
                      onChange={(e) => setIncludesMembership(program, e.target.checked)}
                      aria-label={`${program.name} includes membership`}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <DataTablePager table={table} itemLabel="programs" />
      </div>
    </div>
  );
}
