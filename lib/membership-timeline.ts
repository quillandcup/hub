// Reconciles a member's overlapping data sources (Kajabi membership stints,
// hiatuses, program-cohort enrollments, status overrides) into a single flat,
// chronological, non-overlapping sequence of "what was true" segments.
//
// Why this exists: hiatuses happen *during* membership stints, not
// sequentially with them — a member can go on hiatus in the middle of an
// active subscription, resume, then cancel later. Treating each source as
// its own list of rows (as the UI previously did) produces a merged view
// where a hiatus row and the stint it interrupted sit side by side with no
// indication that one is nested inside the other, and "gap"/"active"
// captions computed within one source's own sequence get attached to
// visually-adjacent rows from a *different* source. Sweeping across all
// sources by time and assigning one state to every instant fixes both: each
// resulting segment has an unambiguous start/end and a single duration
// meaning (how long that exact state held), and adjacent segments are
// always truly adjacent in time.
//
// State priority at any instant (highest wins, mirrors reprocess_members_atomic):
//   1. hiatus            — a member on hiatus is not counted active, full stop
//   2. active            — a real Kajabi stint, OR a gift/direct_stripe
//                           override, OR a program-cohort enrollment
//   3. gap                — none of the above cover this instant
//
// "special" status overrides don't grant active status on their own (see
// reprocess_members_atomic Step 4), so they never change the state, but
// they're still surfaced as an annotation on whatever segment they overlap
// so the record isn't lost.
//
// Date handling: hiatus and program-cohort dates are DATE columns (calendar
// days with no real time-of-day), so they're parsed with parseDateOnly to
// avoid `new Date("2026-07-21")`'s UTC-midnight parsing rendering as the
// previous day in timezones behind UTC. Membership stints and status
// overrides are TIMESTAMPTZ — real instants — so they're parsed as-is.

import { parseDateOnly } from "@/lib/member-tenure";

export type TimelineSegmentState = "active" | "hiatus" | "gap";

export interface MembershipStintInput {
  created_at_kajabi: string;
  derived_end_at: string | null;
}

export interface HiatusInput {
  id: string;
  start_date: string;
  end_date: string | null;
  reason: string | null;
  notes: string | null;
}

export interface ProgramEnrollmentInput {
  starts_at: string;
  expires_at: string | null;
  reason: string | null; // program name
}

export interface StatusOverrideInput {
  override_type: string;
  reason: string | null;
  starts_at: string;
  expires_at: string | null;
}

export interface TimelineSegment {
  state: TimelineSegmentState;
  startDate: Date;
  endDate: Date | null; // null = ongoing (open-ended)
  reasonTags: string[]; // e.g. ["Membership"], ["Membership", "180 Program"], ["Gift"]
  hiatus?: { id: string; reason: string | null; notes: string | null };
}

const ACTIVE_OVERRIDE_TYPES = new Set(["gift", "direct_stripe"]);

export const OVERRIDE_TYPE_LABEL: Record<string, string> = {
  gift: "Gift",
  direct_stripe: "Direct Stripe",
  special: "Special",
};

type CoverageKind = "membership" | "hiatus" | "activeOverride" | "program" | "annotation";

interface Coverage {
  start: number;
  end: number | null; // null = open-ended
  kind: CoverageKind;
  label: string;
  hiatusId?: string;
  hiatusReason?: string | null;
  hiatusNotes?: string | null;
}

function coversInstant(c: Coverage, instant: number): boolean {
  return c.start <= instant && (c.end === null || c.end > instant);
}

function sameTags(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

export function buildMembershipTimeline(
  membershipHistory: MembershipStintInput[],
  hiatusHistory: HiatusInput[],
  programOverrides: ProgramEnrollmentInput[] = [],
  statusOverrides: StatusOverrideInput[] = []
): TimelineSegment[] {
  const coverages: Coverage[] = [];

  for (const m of membershipHistory) {
    coverages.push({
      start: new Date(m.created_at_kajabi).getTime(),
      end: m.derived_end_at ? new Date(m.derived_end_at).getTime() : null,
      kind: "membership",
      label: "Membership",
    });
  }

  for (const h of hiatusHistory) {
    coverages.push({
      start: parseDateOnly(h.start_date).getTime(),
      end: h.end_date ? parseDateOnly(h.end_date).getTime() : null,
      kind: "hiatus",
      label: h.reason ?? "",
      hiatusId: h.id,
      hiatusReason: h.reason,
      hiatusNotes: h.notes,
    });
  }

  for (const p of programOverrides) {
    coverages.push({
      start: parseDateOnly(p.starts_at).getTime(),
      end: p.expires_at ? parseDateOnly(p.expires_at).getTime() : null,
      kind: "program",
      label: p.reason ?? "Program",
    });
  }

  for (const s of statusOverrides) {
    coverages.push({
      start: new Date(s.starts_at).getTime(),
      end: s.expires_at ? new Date(s.expires_at).getTime() : null,
      kind: ACTIVE_OVERRIDE_TYPES.has(s.override_type) ? "activeOverride" : "annotation",
      label: OVERRIDE_TYPE_LABEL[s.override_type] ?? s.override_type,
    });
  }

  if (coverages.length === 0) return [];

  const points = new Set<number>();
  for (const c of coverages) {
    points.add(c.start);
    if (c.end !== null) points.add(c.end);
  }
  const boundaries = [...points].sort((a, b) => a - b);

  const rawSegments: TimelineSegment[] = [];
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i];
    const end = i + 1 < boundaries.length ? boundaries[i + 1] : null;
    if (end !== null && end <= start) continue;

    const probe = start; // half-open interval [start, end) — start is always covered by anything spanning this slice
    const hiatusCov = coverages.find((c) => c.kind === "hiatus" && coversInstant(c, probe));
    const membershipCovs = coverages.filter((c) => c.kind === "membership" && coversInstant(c, probe));
    const activeOverrideCovs = coverages.filter((c) => c.kind === "activeOverride" && coversInstant(c, probe));
    const programCovs = coverages.filter((c) => c.kind === "program" && coversInstant(c, probe));
    const annotationCovs = coverages.filter((c) => c.kind === "annotation" && coversInstant(c, probe));

    let state: TimelineSegmentState;
    const reasonTags: string[] = [];
    let hiatus: TimelineSegment["hiatus"];

    if (hiatusCov) {
      state = "hiatus";
      hiatus = { id: hiatusCov.hiatusId!, reason: hiatusCov.hiatusReason ?? null, notes: hiatusCov.hiatusNotes ?? null };
    } else if (membershipCovs.length > 0 || activeOverrideCovs.length > 0 || programCovs.length > 0) {
      state = "active";
      if (membershipCovs.length > 0) reasonTags.push("Membership");
      else for (const o of activeOverrideCovs) reasonTags.push(o.label);
      // Programs (and, if membership already explains it, overrides too) are
      // secondary context, not restated as the primary reason.
      if (membershipCovs.length > 0) for (const o of activeOverrideCovs) reasonTags.push(o.label);
      for (const p of programCovs) reasonTags.push(p.label);
    } else {
      state = "gap";
    }
    for (const a of annotationCovs) reasonTags.push(a.label);

    rawSegments.push({
      state,
      startDate: new Date(start),
      endDate: end === null ? null : new Date(end),
      reasonTags,
      hiatus,
    });
  }

  const merged: TimelineSegment[] = [];
  for (const seg of rawSegments) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.endDate !== null &&
      seg.startDate.getTime() === prev.endDate.getTime() &&
      prev.state === seg.state &&
      sameTags(prev.reasonTags, seg.reasonTags) &&
      (prev.hiatus?.id ?? null) === (seg.hiatus?.id ?? null)
    ) {
      prev.endDate = seg.endDate;
    } else {
      merged.push({ ...seg });
    }
  }

  // Drop a trailing open-ended gap: once every known source has lapsed with
  // nothing left covering "now", the member simply isn't currently active —
  // that's already obvious from the last real segment's end date, so an
  // infinite "gap, so far" row would just be noise on every lapsed member's
  // timeline.
  const last = merged[merged.length - 1];
  if (last && last.state === "gap" && last.endDate === null) merged.pop();

  return merged.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
}
