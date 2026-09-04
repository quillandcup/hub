"use client";

import { useEffect, useState } from "react";
import MemberSearch from "@/components/MemberSearch";

interface Member {
  id: string;
  name: string;
  email: string;
  status?: string;
}

interface Enrollment {
  id: string;
  notes: string | null;
  member: Member;
}

interface Cohort {
  id: string;
  program_id: string;
  name: string;
  starts_at: string;
  expires_at: string;
  notes: string | null;
  member_program_enrollments: Enrollment[];
}

interface LeakageRow {
  member_id: string;
  member_name: string;
  member_email: string;
  member_status: string;
  cohort_name: string;
  expired_at: string;
  days_since_expiry: number;
}

interface ProgramDetailData {
  program: { id: string; name: string };
  cohorts: Cohort[];
  leakage: LeakageRow[];
}

function fmtDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString();
}

// Six months out, clamping day-of-month like the Hedgieversary math does
// (lib/member-tenure.ts addMonthsClamped) — just a form default, staff can
// still edit it.
function suggestExpiry(startsAt: string): string {
  const d = new Date(`${startsAt}T00:00:00Z`);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 6, d.getUTCDate()));
  return target.toISOString().split("T")[0];
}

export default function ProgramDetailClient({ programId }: { programId: string }) {
  const [data, setData] = useState<ProgramDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCohortForm, setShowCohortForm] = useState(false);
  const [cohortForm, setCohortForm] = useState({ name: "", starts_at: "", expires_at: "", notes: "" });
  const [savingCohort, setSavingCohort] = useState(false);

  const [editingCohortId, setEditingCohortId] = useState<string | null>(null);
  const [editCohortForm, setEditCohortForm] = useState({ name: "", starts_at: "", expires_at: "", notes: "" });
  const [savingCohortEdit, setSavingCohortEdit] = useState(false);

  const [allMembers, setAllMembers] = useState<Member[]>([]);

  const [enrollingCohortId, setEnrollingCohortId] = useState<string | null>(null);
  const [enrollMember, setEnrollMember] = useState<Member | null>(null);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);

  useEffect(() => {
    fetchData();
  }, [programId]);

  useEffect(() => {
    fetch("/api/members")
      .then((res) => res.json())
      .then((body) => setAllMembers(body.members || []))
      .catch(() => {});
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/admin/programs/${programId}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to fetch program");
      setData(body);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCohort = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSavingCohort(true);
    try {
      const response = await fetch("/api/admin/program-cohorts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ program_id: programId, ...cohortForm, notes: cohortForm.notes || null }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to create cohort");
      setShowCohortForm(false);
      setCohortForm({ name: "", starts_at: "", expires_at: "", notes: "" });
      fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingCohort(false);
    }
  };

  const startEditCohort = (cohort: Cohort) => {
    setEditingCohortId(cohort.id);
    setEditCohortForm({
      name: cohort.name,
      starts_at: cohort.starts_at,
      expires_at: cohort.expires_at,
      notes: cohort.notes ?? "",
    });
  };

  const handleUpdateCohort = async (e: React.FormEvent, id: string) => {
    e.preventDefault();
    setError(null);
    setSavingCohortEdit(true);
    try {
      const response = await fetch(`/api/admin/program-cohorts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editCohortForm, notes: editCohortForm.notes || null }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to update cohort");
      setEditingCohortId(null);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingCohortEdit(false);
    }
  };

  const handleDeleteCohort = async (id: string) => {
    if (!confirm("Delete this cohort? This also removes everyone's enrollment in it.")) return;
    const response = await fetch(`/api/admin/program-cohorts/${id}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json();
      setError(body.error || "Failed to delete cohort");
      return;
    }
    fetchData();
  };

  const handleEnroll = async (e: React.FormEvent, cohortId: string) => {
    e.preventDefault();
    setEnrollError(null);
    if (!enrollMember) {
      setEnrollError("Select a member first");
      return;
    }
    setEnrolling(true);
    try {
      const response = await fetch("/api/admin/program-enrollments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: enrollMember.id, cohort_id: cohortId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to enroll member");

      setEnrollMember(null);
      setEnrollingCohortId(null);
      fetchData();
    } catch (err: any) {
      setEnrollError(err.message);
    } finally {
      setEnrolling(false);
    }
  };

  const handleRemoveEnrollment = async (id: string) => {
    if (!confirm("Remove this enrollment?")) return;
    const response = await fetch(`/api/admin/program-enrollments/${id}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json();
      setError(body.error || "Failed to remove enrollment");
      return;
    }
    fetchData();
  };

  if (loading) return <p className="text-slate-500">Loading...</p>;
  if (!data) return <p className="text-red-600">{error || "Not found"}</p>;

  return (
    <div className="space-y-8">
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded text-sm text-red-800 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Leakage report */}
      {data.leakage.length > 0 && (
        <section className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-1">Lapsed Without Converting</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
            These members&apos; cohort window has ended and they never converted to real paid membership — worth a
            follow-up.
          </p>
          <div className="border border-gray-200 dark:border-slate-700 rounded overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-slate-800">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Member</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Cohort</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Status</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Expired</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Days Since</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-800">
                {data.leakage.map((row) => (
                  <tr key={row.member_id}>
                    <td className="px-4 py-2">
                      <div className="font-medium">{row.member_name}</div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">{row.member_email}</div>
                    </td>
                    <td className="px-4 py-2 text-sm">{row.cohort_name}</td>
                    <td className="px-4 py-2 text-sm">{row.member_status}</td>
                    <td className="px-4 py-2 text-sm">{fmtDate(row.expired_at)}</td>
                    <td className="px-4 py-2 text-sm">{row.days_since_expiry}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Cohorts */}
      <section className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Cohorts</h2>
          {!showCohortForm && (
            <button
              onClick={() => setShowCohortForm(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
            >
              Add Cohort
            </button>
          )}
        </div>

        {showCohortForm && (
          <form onSubmit={handleCreateCohort} className="mb-6 p-4 border border-gray-200 dark:border-slate-700 rounded bg-gray-50 dark:bg-slate-800 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">Name</label>
                <input
                  type="text"
                  value={cohortForm.name}
                  onChange={(e) => setCohortForm({ ...cohortForm, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded"
                  placeholder="e.g., Fall 2026 Launch"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">Starts</label>
                <input
                  type="date"
                  value={cohortForm.starts_at}
                  onChange={(e) =>
                    setCohortForm({
                      ...cohortForm,
                      starts_at: e.target.value,
                      expires_at: cohortForm.expires_at || suggestExpiry(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">Expires</label>
                <input
                  type="date"
                  value={cohortForm.expires_at}
                  onChange={(e) => setCohortForm({ ...cohortForm, expires_at: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded"
                  required
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Defaults to 6 months out</p>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-gray-200">Notes (optional)</label>
              <input
                type="text"
                value={cohortForm.notes}
                onChange={(e) => setCohortForm({ ...cohortForm, notes: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded"
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={savingCohort} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                {savingCohort ? "Saving..." : "Create Cohort"}
              </button>
              <button
                type="button"
                onClick={() => setShowCohortForm(false)}
                className="px-4 py-2 bg-gray-300 dark:bg-slate-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-400 dark:hover:bg-slate-600"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {data.cohorts.length === 0 ? (
          <p className="text-gray-500">No cohorts yet.</p>
        ) : (
          <div className="space-y-3">
            {data.cohorts.map((cohort) => (
              <div key={cohort.id} className="border border-gray-200 dark:border-slate-700 rounded p-3">
                {editingCohortId === cohort.id ? (
                  <form onSubmit={(e) => handleUpdateCohort(e, cohort.id)} className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-sm font-medium mb-1 dark:text-gray-200">Name</label>
                        <input
                          type="text"
                          value={editCohortForm.name}
                          onChange={(e) => setEditCohortForm({ ...editCohortForm, name: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1 dark:text-gray-200">Starts</label>
                        <input
                          type="date"
                          value={editCohortForm.starts_at}
                          onChange={(e) => setEditCohortForm({ ...editCohortForm, starts_at: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1 dark:text-gray-200">Expires</label>
                        <input
                          type="date"
                          value={editCohortForm.expires_at}
                          onChange={(e) => setEditCohortForm({ ...editCohortForm, expires_at: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded"
                          required
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1 dark:text-gray-200">Notes (optional)</label>
                      <input
                        type="text"
                        value={editCohortForm.notes}
                        onChange={(e) => setEditCohortForm({ ...editCohortForm, notes: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button type="submit" disabled={savingCohortEdit} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm">
                        {savingCohortEdit ? "Saving..." : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingCohortId(null)}
                        className="px-4 py-2 bg-gray-300 dark:bg-slate-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-400 dark:hover:bg-slate-600 text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-medium">{cohort.name}</h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {fmtDate(cohort.starts_at)} – {fmtDate(cohort.expires_at)}
                      </p>
                      {cohort.notes && <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">{cohort.notes}</p>}
                    </div>
                    <div className="flex gap-3 shrink-0">
                      <button
                        onClick={() => startEditCohort(cohort)}
                        className="text-blue-600 dark:text-blue-400 hover:underline text-sm"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteCohort(cohort.id)}
                        className="text-red-600 hover:text-red-800 text-sm"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-2">
                  <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Enrolled ({cohort.member_program_enrollments.length})
                  </h4>
                  {cohort.member_program_enrollments.length > 0 && (
                    <div className="mb-1.5 flex flex-wrap gap-1.5">
                      {cohort.member_program_enrollments.map((enrollment) => (
                        <span
                          key={enrollment.id}
                          className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 bg-gray-100 dark:bg-slate-800 rounded text-xs"
                        >
                          {enrollment.member.name}
                          <button
                            onClick={() => handleRemoveEnrollment(enrollment.id)}
                            className="text-gray-400 hover:text-red-600 dark:hover:text-red-400 leading-none"
                            title="Remove from cohort"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {enrollingCohortId === cohort.id ? (
                    <form onSubmit={(e) => handleEnroll(e, cohort.id)} className="flex items-start gap-2">
                      <div className="flex-1">
                        <MemberSearch
                          members={allMembers}
                          selectedMemberId={enrollMember?.id ?? null}
                          onSelect={setEnrollMember}
                          placeholder="Search by name or email..."
                        />
                        {enrollError && <p className="text-xs text-red-600 mt-1">{enrollError}</p>}
                      </div>
                      <button type="submit" disabled={enrolling || !enrollMember} className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-50">
                        {enrolling ? "Enrolling..." : "Enroll"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEnrollingCohortId(null);
                          setEnrollMember(null);
                          setEnrollError(null);
                        }}
                        className="px-3 py-1.5 bg-gray-300 dark:bg-slate-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-400 dark:hover:bg-slate-600 text-sm"
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <button
                      onClick={() => setEnrollingCohortId(cohort.id)}
                      className="text-blue-600 dark:text-blue-400 hover:underline text-sm"
                    >
                      + Enroll a member
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
