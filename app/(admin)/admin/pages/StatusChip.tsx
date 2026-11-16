/** Draft or Published: the one chip the list and the editor share. */
export default function StatusChip({ status }: { status: string }) {
  const published = status === "published";
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
        published ? "bg-mist-100 text-mist-800 dark:bg-mist-900/40 dark:text-mist-200" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
      }`}
    >
      {published ? "Published" : "Draft"}
    </span>
  );
}
