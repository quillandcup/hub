import Link from "next/link";
import { feedSearch, MEMBER_DEFAULTS } from "@/lib/activity-feed";
import { formatDateTime } from "@/lib/formatters";

/** The member's newest staff note as the Overview shows it: the author is a display name, null once their account is gone. */
export interface LatestNote {
  body: string;
  createdAt: string;
  authorName: string | null;
}

/**
 * "Latest note" on the Overview: the newest staff note with who wrote it and when, and a link to all of them,
 * which is the Activity Log tab narrowed to notes over the longest range. With no notes it links to the tab,
 * where the add box is.
 */
export default function LatestNoteCard({ memberId, note, timeZone, readOnly = false }: { memberId: string; note: LatestNote | null; timeZone: string; readOnly?: boolean }) {
  const activity = `/admin/members/${memberId}/activity`;
  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold">Latest note</h3>
        <Link
          href={note ? `${activity}${feedSearch({ kinds: ["note"], days: 365 }, MEMBER_DEFAULTS)}` : activity}
          className="text-sm text-plum-600 hover:text-plum-700 dark:text-plum-400 dark:hover:text-plum-300 hover:underline"
        >
          {note ? "See all notes" : readOnly ? "Open the activity log" : "Add the first note"} →
        </Link>
      </div>
      {note ? (
        <>
          <p className="text-sm text-slate-900 dark:text-slate-100 whitespace-pre-wrap break-words line-clamp-4">{note.body}</p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {note.authorName ?? "Former staff"} · <time dateTime={note.createdAt}>{formatDateTime(note.createdAt, timeZone)}</time>
          </p>
        </>
      ) : (
        <p className="text-sm text-slate-600 dark:text-slate-400">No notes yet.</p>
      )}
    </div>
  );
}
