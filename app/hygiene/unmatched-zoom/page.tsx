import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface UnmatchedAttendee {
  name: string;
  email: string | null;
  count: number;
  firstSeen: string;
  lastSeen: string;
}

export default async function UnmatchedZoomPage() {
  const supabase = await createClient();

  // Get all zoom attendees from last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: zoomAttendees } = await supabase
    .from("zoom_attendees")
    .select("name, email, join_time")
    .gte("join_time", thirtyDaysAgo.toISOString())
    .order("join_time", { ascending: false });

  // Get all members and aliases for matching
  const [{ data: members }, { data: aliases }] = await Promise.all([
    supabase.from("members").select("id, name, email"),
    supabase.from("member_name_aliases").select("alias, member_id"),
  ]);

  // Build lookup maps
  const membersByEmail = new Map(
    members?.map((m) => [m.email.toLowerCase(), m]) || []
  );
  const aliasToMember = new Map<string, any>();
  aliases?.forEach((a) => {
    const member = members?.find((m) => m.id === a.member_id);
    if (member) aliasToMember.set(a.alias, member);
  });

  // Helper to normalize name
  function normalizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  const membersByNormalizedName = new Map(
    members?.map((m) => [normalizeName(m.name), m]) || []
  );

  // Helper to match attendee (same logic as attendance processing)
  function isMatched(name: string, email: string | null): boolean {
    // Try email match
    if (email && membersByEmail.has(email.toLowerCase())) {
      return true;
    }

    // Try alias match (with whitespace trimming)
    const trimmedName = name.trim();
    if (aliasToMember.has(trimmedName)) {
      return true;
    }

    // Try normalized name match
    const normalized = normalizeName(name);
    if (membersByNormalizedName.has(normalized)) {
      return true;
    }

    return false;
  }

  // Group unmatched attendees by name
  const unmatchedMap = new Map<string, UnmatchedAttendee>();

  zoomAttendees?.forEach((attendee) => {
    if (!isMatched(attendee.name, attendee.email)) {
      const key = `${attendee.name}|${attendee.email || ""}`;
      const existing = unmatchedMap.get(key);

      if (existing) {
        existing.count++;
        existing.firstSeen = attendee.join_time; // Will be earliest due to desc order
      } else {
        unmatchedMap.set(key, {
          name: attendee.name,
          email: attendee.email,
          count: 1,
          firstSeen: attendee.join_time,
          lastSeen: attendee.join_time,
        });
      }
    }
  });

  const unmatched = Array.from(unmatchedMap.values()).sort((a, b) => b.count - a.count);

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">
            Unmatched Zoom Attendees
          </h1>
          <p className="text-slate-600 dark:text-slate-400 mt-2">
            Zoom names that didn't match to any member (last 30 days)
          </p>
        </div>

        {unmatched.length === 0 ? (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-8 text-center">
            <span className="text-4xl mb-2 block">✅</span>
            <p className="text-lg font-medium text-green-900 dark:text-green-100">
              All Zoom attendees matched!
            </p>
            <p className="text-sm text-green-700 dark:text-green-300 mt-1">
              No unmatched attendees in the last 30 days.
            </p>
          </div>
        ) : (
          <>
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
              <p className="text-sm text-blue-900 dark:text-blue-100">
                <strong>{unmatched.length} unique unmatched names</strong> found.
                These attendees were not matched to any member via email, alias, or name normalization.
              </p>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                Tip: Check for trailing spaces, typos, or missing aliases.
                Go to <a href="/hygiene/name-matching" className="underline">Name Matching</a> to create aliases.
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-lg shadow border border-slate-200 dark:border-slate-800 overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Zoom Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Occurrences
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Last Seen
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {unmatched.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-900 dark:text-slate-100">
                            "{item.name}"
                          </span>
                          {item.name !== item.name.trim() && (
                            <span className="text-xs px-2 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 rounded">
                              whitespace
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          Length: {item.name.length} chars
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">
                        {item.email || <span className="italic">no email</span>}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-900 dark:text-slate-100">
                        {item.count}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">
                        {new Date(item.lastSeen).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
