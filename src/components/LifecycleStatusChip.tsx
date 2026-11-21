/**
 * Draft or Published: THE pill for whether members (or the public) can open something, the same in every list and header
 * (landing pages, courses). It says "Published" or "Draft" and nothing else; reasons live next to it, in text.
 *
 * Published is a solid fill in the brand mist with a filled dot, Draft a quiet slate with an empty one, so they differ in shape
 * as well as color and stay clearly apart in dark mode (a tinted fill at 40% read as gray there).
 */
export default function LifecycleStatusChip({ published }: { published: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
        published ? "bg-mist-200 text-mist-900 dark:bg-mist-700 dark:text-mist-50" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
      }`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${published ? "bg-mist-700 dark:bg-mist-200" : "border border-slate-400 dark:border-slate-500"}`} />
      {published ? "Published" : "Draft"}
    </span>
  );
}
