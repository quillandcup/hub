/**
 * Draft or Published: THE pill for whether members (or the public) can open something, the same in every list and header
 * (landing pages, courses). It says "Published" or "Draft" and nothing else; reasons live next to it, in text.
 */
export default function LifecycleStatusChip({ published }: { published: boolean }) {
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
