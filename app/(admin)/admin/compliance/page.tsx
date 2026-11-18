import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-auth";
import {
  COMPLIANCE_EFFECTIVE,
  COMPLIANCE_GROUPS,
  COMPLIANCE_PROVIDERS,
  COMPLIANCE_STATUSES,
  complianceItemId,
  type ComplianceStatus,
} from "@/lib/compliance";
import { OpenSummary, StaffIntro, StaffPage, StaffRows, StatusKey, type StaffRow } from "@/components/trust/StaffView";
import { TrustNav, TrustSection } from "@/components/trust/Trust";

export const metadata: Metadata = {
  title: "Compliance",
};

const ALL_ROWS: StaffRow[] = COMPLIANCE_GROUPS.flatMap((group) =>
  group.items.map((item) => ({
    id: complianceItemId(item.name),
    title: item.name,
    status: item.status,
    about: item.about,
    member: item.detail,
    evidence: item.evidence,
    checked: item.checked,
    open: item.open,
  })),
);

/**
 * The staff view of the Compliance page: the same list as `/compliance`, with where each row is enforced,
 * when it was last checked and what is still open. The repo is public, so the detail here is public-safe by
 * design (see `lib/compliance.ts`).
 */
export default async function AdminCompliancePage() {
  await requireAdminPage();

  return (
    <StaffPage title="Compliance">
      <StaffIntro publicHref="/compliance" publicName="Compliance" listFile="lib/compliance.ts" effective={COMPLIANCE_EFFECTIVE} />
      <OpenSummary rows={ALL_ROWS} />
      <StatusKey statuses={Object.keys(COMPLIANCE_STATUSES) as ComplianceStatus[]} />
      <TrustNav links={[...COMPLIANCE_GROUPS.map((g) => ({ id: g.id, title: g.title })), { id: "providers", title: "Services we rely on" }]} />

      {COMPLIANCE_GROUPS.map((group) => (
        <StaffRows
          key={group.id}
          id={group.id}
          title={group.title}
          intro={group.intro}
          rows={ALL_ROWS.filter((row) => group.items.some((item) => complianceItemId(item.name) === row.id))}
        />
      ))}

      <TrustSection id="providers" title="Services we rely on">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700 text-left">
              <th className="py-2 pr-4 font-semibold">Service</th>
              <th className="py-2 pr-4 font-semibold">What it does</th>
              <th className="py-2 font-semibold">What it covers</th>
            </tr>
          </thead>
          <tbody className="align-top">
            {COMPLIANCE_PROVIDERS.map((provider) => (
              <tr key={provider.name} className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-2 pr-4 font-medium text-slate-900 dark:text-slate-100">{provider.name}</td>
                <td className="py-2 pr-4">{provider.role}</td>
                <td className="py-2">{provider.covers}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TrustSection>
    </StaffPage>
  );
}
