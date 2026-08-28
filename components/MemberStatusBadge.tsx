// Matches the members_status_check DB constraint (supabase/migrations/20260826120000_extend_member_status_lifecycle.sql)
export type MemberStatus = "active" | "lead" | "cancelled" | "on_hiatus";

const STATUS_COLORS: Record<MemberStatus, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  lead: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  on_hiatus: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
};

export function MemberStatusBadge({ status }: { status: MemberStatus }) {
  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[status]}`}>
      {status.replace("_", " ")}
    </span>
  );
}
