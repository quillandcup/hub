"use client";

import { useEffect, useState } from "react";
import MemberSearch from "@/components/MemberSearch";
import MultiSelectSearch from "@/components/MultiSelectSearch";

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

interface KajabiCandidate {
  member_id: string;
  member_name: string;
  member_email: string;
  member_status: string;
  offer_names: string[];
  purchase_date: string | null;
  effective_start_at: string | null;
  deactivated_at: string | null;
  already_enrolled_elsewhere: string | null;
}

interface ProgramDetailData {
  program: { id: string; name: string; kajabi_offer_names: string[] };
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

  const [allOfferNames, setAllOfferNames] = useState<string[]>([]);
  const [offerNamesSelection, setOfferNamesSelection] = useState<string[]>([]);
  const [savingOfferNames, setSavingOfferNames] = useState(false);

  const [matchesByCohortId, setMatchesByCohortId] = useState<Record<string, KajabiCandidate[]>>({});
  const [offerNamesConfiguredByCohortId, setOfferNamesConfiguredByCohortId] = useState<Record<string, boolean>>({});
  const [matchesLoadingCohortId, setMatchesLoadingCohortId] = useState<string | null>(null);
  const [matchesError, setMatchesError] = useState<string | null>(null);
  const [selectedCandidates, setSelectedCandidates] = useState<Record<string, Set<string>>>({});
  const [enrollingSelectedCohortId, setEnrollingSelectedCohortId] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, [programId]);

  useEffect(() => {
    fetch("/api/members")
      .then((res) => res.json())
      .then((body) => setAllMembers(body.members || []))
      .catch(() => {});
    fetch("/api/admin/kajabi-offers")
      .then((res) => res.json())
      .then((body) => setAllOfferNames(body.names || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (data?.program) setOfferNamesSelection(data.program.kajabi_offer_names || []);
  }, [data?.program.id]);

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

  const handleSaveOfferNames = async () => {
    setError(null);
    setSavingOfferNames(true);
    try {
      const response = await fetch(`/api/admin/programs/${programId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kajabi_offer_names: offerNamesSelection }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to save offer names");
      fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingOfferNames(false);
    }
  };

  const handleFindMatches = async (cohortId: string) => {
    setMatchesError(null);
    setMatchesLoadingCohortId(cohortId);
    try {
      const response = await fetch(`/api/admin/program-cohorts/${cohortId}/kajabi-matches`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to find Kajabi matches");
      setMatchesByCohortId((prev) => ({ ...prev, [cohortId]: body.candidates }));
      setOfferNamesConfiguredByCohortId((prev) => ({ ...prev, [cohortId]: body.offerNamesConfigured }));
      setSelectedCandidates((prev) => ({
        ...prev,
        // Default-check only the clean matches. A candidate already enrolled
        // in a different cohort of this program is a real, legitimate
        // ambiguity (e.g. two cohorts' windows genuinely overlap) rather than
        // a bug — leave it unchecked so bulk-enrolling doesn't double-enroll
        // someone who's already correctly placed elsewhere without staff
        // deliberately opting in.
        [cohortId]: new Set<string>(
          body.candidates.filter((c: KajabiCandidate) => !c.already_enrolled_elsewhere).map((c: KajabiCandidate) => c.member_id)
        ),
      }));
    } catch (err: any) {
      setMatchesError(err.message);
    } finally {
      setMatchesLoadingCohortId(null);
    }
  };

  const handleCloseMatches = (cohortId: string) => {
    setMatchesByCohortId((prev) => {
      const next = { ...prev };
      delete next[cohortId];
      return next;
    });
    setMatchesError(null);
  };

  const toggleCandidateSelected = (cohortId: string, memberId: string) => {
    setSelectedCandidates((prev) => {
      const current = new Set(prev[cohortId] ?? []);
      if (current.has(memberId)) current.delete(memberId);
      else current.add(memberId);
      return { ...prev, [cohortId]: current };
    });
  };

  const handleEnrollSelected = async (cohortId: string) => {
    const selected = selectedCandidates[cohortId] ?? new Set<string>();
    if (selected.size === 0) return;
    setMatchesError(null);
    setEnrollingSelectedCohortId(cohortId);
    try {
      const results = await Promise.all(
        Array.from(selected).map((memberId) =>
          fetch("/api/admin/program-enrollments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ member_id: memberId, cohort_id: cohortId }),
          })
        )
      );
      const failed = results.filter((r) => !r.ok && r.status !== 409);
      if (failed.length > 0) {
        setMatchesError(`${failed.length} of ${results.length} enrollments failed`);
      }
      handleCloseMatches(cohortId);
      fetchData();
    } catch (err: any) {
      setMatchesError(err.message);
    } finally {
      setEnrollingSelectedCohortId(null);
    }
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

      {/* Kajabi offer names — which Kajabi offers count as a purchase of this program */}
      <section className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-1">Kajabi Offer Names</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
          Which Kajabi offers count as a purchase of this program — used by &quot;Find Kajabi matches&quot; below to
          suggest members to enroll in a cohort.
        </p>
        <MultiSelectSearch
          options={allOfferNames}
          selected={offerNamesSelection}
          onChange={setOfferNamesSelection}
          placeholder="Search Kajabi offers..."
          className="mb-3"
          chipNote={(name) => (allOfferNames.includes(name) ? undefined : "(not in current Kajabi catalog)")}
        />
        <button
          onClick={handleSaveOfferNames}
          disabled={savingOfferNames}
          className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-50"
        >
          {savingOfferNames ? "Saving..." : "Save Offer Names"}
        </button>
      </section>

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
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setEnrollingCohortId(cohort.id)}
                        className="text-blue-600 dark:text-blue-400 hover:underline text-sm"
                      >
                        + Enroll a member
                      </button>
                      <button
                        onClick={() => handleFindMatches(cohort.id)}
                        disabled={matchesLoadingCohortId === cohort.id}
                        className="text-blue-600 dark:text-blue-400 hover:underline text-sm disabled:opacity-50"
                      >
                        {matchesLoadingCohortId === cohort.id ? "Searching..." : "Find Kajabi matches"}
                      </button>
                    </div>
                  )}

                  {matchesByCohortId[cohort.id] !== undefined && (
                    <div className="mt-3 p-3 border border-blue-200 dark:border-blue-900 rounded bg-blue-50 dark:bg-blue-950/30">
                      {matchesError && <p className="text-xs text-red-600 mb-2">{matchesError}</p>}
                      {!offerNamesConfiguredByCohortId[cohort.id] ? (
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                          No Kajabi offer names are configured for this program — pick offers above under
                          &quot;Kajabi Offer Names&quot; to enable matching.
                        </p>
                      ) : matchesByCohortId[cohort.id].length === 0 ? (
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                          No unmatched Kajabi purchases found in this cohort&apos;s window.
                        </p>
                      ) : (
                        <>
                          {(() => {
                            const cleanCount = matchesByCohortId[cohort.id].filter((c) => !c.already_enrolled_elsewhere).length;
                            const elsewhereCount = matchesByCohortId[cohort.id].length - cleanCount;
                            return (
                              <p className="text-sm font-medium mb-2">
                                {cleanCount} candidate{cleanCount !== 1 ? "s" : ""} found
                                {elsewhereCount > 0 &&
                                  ` (+${elsewhereCount} already enrolled in another cohort — shown below, unchecked)`}
                              </p>
                            );
                          })()}
                          <div className="space-y-1.5 mb-3">
                            {[...matchesByCohortId[cohort.id]]
                              .sort((a, b) => (a.already_enrolled_elsewhere ? 1 : 0) - (b.already_enrolled_elsewhere ? 1 : 0))
                              .map((candidate) => (
                              <label
                                key={candidate.member_id}
                                className={
                                  candidate.already_enrolled_elsewhere
                                    ? "flex items-start gap-2 text-sm bg-white dark:bg-slate-900 rounded px-2 py-1.5 opacity-60"
                                    : "flex items-start gap-2 text-sm bg-white dark:bg-slate-900 rounded px-2 py-1.5"
                                }
                              >
                                <input
                                  type="checkbox"
                                  className="mt-0.5"
                                  checked={(selectedCandidates[cohort.id] ?? new Set()).has(candidate.member_id)}
                                  onChange={() => toggleCandidateSelected(cohort.id, candidate.member_id)}
                                />
                                <span>
                                  <span className="font-medium">{candidate.member_name}</span>{" "}
                                  <span className="text-gray-500 dark:text-gray-400">{candidate.member_email}</span>
                                  <span className="block text-xs text-gray-500 dark:text-gray-400">
                                    {candidate.offer_names.join(", ")}
                                    {candidate.purchase_date && ` · purchased ${fmtDate(candidate.purchase_date.split("T")[0])}`}
                                    {candidate.deactivated_at && " · since refunded/cancelled"}
                                  </span>
                                  {candidate.already_enrolled_elsewhere && (
                                    <span className="block text-xs text-amber-700 dark:text-amber-400">
                                      Already enrolled in {candidate.already_enrolled_elsewhere}
                                    </span>
                                  )}
                                </span>
                              </label>
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleEnrollSelected(cohort.id)}
                              disabled={
                                enrollingSelectedCohortId === cohort.id ||
                                (selectedCandidates[cohort.id]?.size ?? 0) === 0
                              }
                              className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-50"
                            >
                              {enrollingSelectedCohortId === cohort.id
                                ? "Enrolling..."
                                : `Enroll Selected (${selectedCandidates[cohort.id]?.size ?? 0})`}
                            </button>
                            <button
                              onClick={() => handleCloseMatches(cohort.id)}
                              className="px-3 py-1.5 bg-gray-300 dark:bg-slate-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-400 dark:hover:bg-slate-600 text-sm"
                            >
                              Close
                            </button>
                          </div>
                        </>
                      )}
                    </div>
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
