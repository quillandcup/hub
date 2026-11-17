import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-auth";
import { COMPLIANCE_STATUSES, type ComplianceStatus } from "@/lib/compliance";
import { PRIVACY_GROUPS, PRIVACY_PROMISES_EFFECTIVE } from "@/lib/privacy-promises";
import { OpenSummary, StaffIntro, StaffRows, StatusKey, type StaffRow } from "@/components/trust/StaffView";
import { TrustNav } from "@/components/trust/Trust";

export const metadata: Metadata = {
  title: "Privacy",
};

const ALL_ROWS: StaffRow[] = PRIVACY_GROUPS.flatMap((group) =>
  group.rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    member: row.member,
    how: row.how,
    evidence: row.evidence,
    checked: row.checked,
    open: row.open,
  })),
);

/**
 * The staff view of the Privacy page: one row per promise it makes, with how the code keeps it, where it is
 * enforced and tested, when it was last checked and what is still open. The member page (`/privacy`) is still
 * written by hand; this list restates its promises, so change them together. The repo is public, so the detail
 * is public-safe by design (see `lib/privacy-promises.ts`).
 */
export default async function AdminPrivacyPage() {
  await requireAdminPage();

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold mb-1">Privacy</h1>
      <StaffIntro publicHref="/privacy" publicName="Privacy" listFile="lib/privacy-promises.ts" effective={PRIVACY_PROMISES_EFFECTIVE} />
      <OpenSummary rows={ALL_ROWS} />
      <StatusKey statuses={Object.keys(COMPLIANCE_STATUSES) as ComplianceStatus[]} />
      <TrustNav links={PRIVACY_GROUPS.map((g) => ({ id: g.id, title: g.title }))} />
      {PRIVACY_GROUPS.map((group) => (
        <StaffRows
          key={group.id}
          id={group.id}
          title={group.title}
          intro={group.intro}
          rows={ALL_ROWS.filter((row) => group.rows.some((r) => r.id === row.id))}
        />
      ))}
    </div>
  );
}
