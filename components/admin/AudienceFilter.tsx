import Link from "next/link";
import { audienceQuery, type Audience } from "@/lib/analytics/audience";

type Params = Record<string, string | string[] | undefined>;

/**
 * The "ignore staff" and "ignore sudo" switches for the usage pages (lib/analytics/audience.ts).
 * Each is a link to the same page with that one filter flipped and every other parameter kept, so
 * the view stays shareable and no script is needed.
 */
export function AudienceFilter({ path, params, audience }: { path: string; params: Params; audience: Audience }) {
  // Everything in the address except the two filters, which are rebuilt from the audience.
  const kept = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "staff" || key === "sudo") continue;
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) kept.append(key, v);
  }
  const hrefWith = (next: Audience) => {
    const query = new URLSearchParams(kept);
    for (const [key, value] of Object.entries(audienceQuery(next))) query.set(key, value);
    const text = query.toString();
    return text ? `${path}?${text}` : path;
  };

  const options = [
    {
      key: "staff",
      on: audience.ignoreStaff,
      label: "Ignore staff",
      hint: "Leave out admins and members with a staff role.",
      href: hrefWith({ ...audience, ignoreStaff: !audience.ignoreStaff }),
    },
    {
      key: "sudo",
      on: audience.ignoreSudo,
      label: "Ignore staff in sudo",
      hint: "Leave out what staff did while viewing as a member.",
      href: hrefWith({ ...audience, ignoreSudo: !audience.ignoreSudo }),
    },
  ];

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Who to count">
      {options.map((o) => (
        <Link
          key={o.key}
          href={o.href}
          title={o.hint}
          aria-pressed={o.on}
          className={`px-3 py-1 rounded-lg border ${
            o.on
              ? "border-plum-600 bg-plum-50 dark:bg-plum-900/20 text-plum-700 dark:text-plum-300"
              : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
        >
          <span aria-hidden="true">{o.on ? "✓ " : ""}</span>
          {o.label}
        </Link>
      ))}
    </div>
  );
}
