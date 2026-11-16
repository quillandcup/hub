/** Draft or Published, the same pill wherever a course's state is shown. */
export default function CourseStatusChip({ isDraft }: { isDraft: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
        isDraft ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" : "bg-plum-100 text-plum-800 dark:bg-plum-900/30 dark:text-plum-200"
      }`}
    >
      {isDraft ? "Draft" : "Published"}
    </span>
  );
}
