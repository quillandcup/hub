import { accessLabel, ACCESS_OPTIONS } from "@/lib/courses/access-options";

const FIELD =
  "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800";

/** What the details tab shows of a course imported from Kajabi: its fields as last imported, read only (Kajabi is where they change until the course is taken over). */
export default function CourseKajabiDetails({
  title,
  slug,
  description,
  accessDuration,
  launchOn,
  includesMembership,
}: {
  title: string;
  /** The Hub slug, or null until the course is in the Hub. */
  slug: string | null;
  description: string | null;
  /** As stored, null = lifetime. Undefined when not in the Hub. */
  accessDuration?: string | null;
  /** The opening day (YYYY-MM-DD, organisation timezone), or "". */
  launchOn: string;
  includesMembership: boolean | null;
}) {
  const accessChoice = accessDuration === undefined ? "" : accessLabel(accessDuration);
  return (
    <form aria-label="Course details as imported" className="grid gap-4 @pair:grid-cols-2">
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Title</span>
        <input type="text" disabled defaultValue={title} className={FIELD} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Address</span>
        <input type="text" disabled defaultValue={slug ?? ""} className={FIELD} />
      </label>
      <label className="block text-sm @pair:col-span-2">
        <span className="mb-1 block font-medium">Description</span>
        <textarea rows={3} disabled defaultValue={description ?? ""} className={FIELD} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Access length</span>
        <select disabled defaultValue={accessChoice} className={FIELD}>
          <option value="" disabled>
            Choose…
          </option>
          {ACCESS_OPTIONS.map((o) => (
            <option key={o.label}>{o.label}</option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Opens</span>
        <input type="date" disabled defaultValue={launchOn} className={FIELD} />
      </label>
      <label className="flex items-center gap-2 text-sm @pair:col-span-2">
        <input type="checkbox" disabled defaultChecked={includesMembership ?? false} />
        <span>Includes membership while the member has access</span>
      </label>
    </form>
  );
}
