import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-auth";
import { SECURITY_EFFECTIVE, SECURITY_ITEMS, SECURITY_STATUSES } from "@/lib/security";
import { OpenSummary, StaffIntro, StaffRows, StatusKey, type StaffRow } from "@/components/trust/StaffView";

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
 * here is public-safe by design (see `lib/security.ts`).
 */
export default async function AdminSecurityPage() {
  await requireAdminPage();

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold mb-1">Security</h1>
      <StaffIntro publicHref="/security" publicName="Security" listFile="lib/security.ts" effective={SECURITY_EFFECTIVE} />
      <OpenSummary rows={ROWS} />
      <StatusKey statuses={SECURITY_STATUSES} />
      <StaffRows id="rows" title="Every row" rows={ROWS} />
    </div>
  );
}
