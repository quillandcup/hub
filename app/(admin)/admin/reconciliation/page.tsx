import { redirect } from "next/navigation";

// Subscription Reconciliation now lives as a section of the merged Data
// Health dashboard, alongside the hygiene tooling it used to duplicate
// (unmatched Slack/Zoom identity matching). Kept as a redirect so old
// links/bookmarks still land somewhere correct.
export default function ReconciliationRedirectPage() {
  redirect("/admin/hygiene#reconciliation");
}
