import type { Metadata } from "next";
import { requirePermission } from "@/lib/admin-auth";
import { SECURITY_EFFECTIVE, SECURITY_GROUPS, SECURITY_ITEMS, SECURITY_STATUSES } from "@/content/security";
import { OpenSummary, StaffIntro, StaffPage, StaffRows, StatusKey, type StaffRow } from "@/components/trust/StaffView";
import { TrustNav } from "@/components/trust/Trust";

export const metadata: Metadata = {
  title: "Security",
};

const ROWS: StaffRow[] = SECURITY_ITEMS.map((item) => ({
  id: item.id,
  title: item.title,
  status: item.status,
  member: item.member,
  how: item.staff.how,
  evidence: item.staff.evidence,
  checked: item.staff.checked,
  open: item.staff.open,
}));

/**
 * The staff view of the Security page: the same list as `/security`, with how each thing works, where it is
 * enforced and tested, when it was last checked and what is still open. The repo is public, so the detail
 * here is public-safe by design (see `src/content/security.ts`).
 */
export default async function AdminSecurityPage() {
  await requirePermission("system.compliance.read");

  return (
    <StaffPage title="Security">
      <StaffIntro publicHref="/security" publicName="Security" listFile="src/content/security.ts" effective={SECURITY_EFFECTIVE} />
      <OpenSummary rows={ROWS} />
      <StatusKey statuses={SECURITY_STATUSES} />
      <TrustNav links={SECURITY_GROUPS.map((g) => ({ id: g.id, title: g.title }))} />
      {SECURITY_GROUPS.map((group) => (
        <StaffRows
          key={group.id}
          id={group.id}
          title={group.title}
          intro={group.intro}
          rows={ROWS.filter((row) => group.items.some((item) => item.id === row.id))}
        />
      ))}
    </StaffPage>
  );
}
