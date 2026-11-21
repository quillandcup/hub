/** Marks an entry that is written but not released: it is only on the admin Changelog, with no date until it goes out. */
export default function HeldLabel() {
  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold normal-case tracking-normal text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
      Held, not released
    </span>
  );
}
