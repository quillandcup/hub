const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  lead: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  on_hiatus: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
};

export function MemberStatusBadge({ status }: { status: string }) {
  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[status] ?? STATUS_COLORS.lead}`}>
      {status.replace("_", " ")}
    </span>
  );
}
