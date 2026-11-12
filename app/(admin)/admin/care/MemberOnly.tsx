import Link from "next/link";

/**
 * "Showing one member's care plans" above a list, with the way back to everyone's. The DMs tab links to a member's plan this
 * way (`?member=`), because a plan's own id never goes in an address. `show` is whether the page was asked for one member;
 * `name` is their name when they have a care plan (else the note says there is none).
 */
export default function MemberOnly({ name, base, show }: { name: string | null; base: string; show: boolean }) {
  if (!show) return null;
  return (
    <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
      {name ? `Showing ${name}'s care plans.` : "That member has no care plans."}{" "}
      <Link href={base} className="font-medium text-plum-700 underline dark:text-plum-300">
        Show everyone
      </Link>
    </p>
  );
}
