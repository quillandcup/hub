"use client";

import { useMemo, useState } from "react";
import MemberSearch from "@/components/MemberSearch";
import { suggestMemberMatches } from "@/lib/member-matching";

interface UnmatchedSlackUser {
  slack_user_id: string;
  email: string | null;
  real_name: string | null;
  display_name: string | null;
  message_count: number;
}

interface Member {
  id: string;
  name: string;
  email: string;
}

type SkipReason = "non_member" | "bot" | "guest";

const SKIP_REASONS: { value: SkipReason; label: string }[] = [
  { value: "non_member", label: "Not a member" },
  { value: "bot", label: "Bot" },
  { value: "guest", label: "Guest" },
];

export default function SlackAliasSearchForm({
  unmatchedSlackUsers,
  allMembers,
}: {
  unmatchedSlackUsers: UnmatchedSlackUser[];
  allMembers: Member[];
}) {
  const [users, setUsers] = useState(unmatchedSlackUsers);
  const [matchingUserId, setMatchingUserId] = useState<string | null>(null);
  const [skippingUserId, setSkippingUserId] = useState<string | null>(null);
  const [skipReason, setSkipReason] = useState<Record<string, SkipReason>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const suggestionsByUserId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof suggestMemberMatches>>();
    for (const user of users) {
      const name = user.real_name || user.display_name || "";
      map.set(user.slack_user_id, suggestMemberMatches(name, user.email, allMembers, 3));
    }
    return map;
  }, [users, allMembers]);

  const clearError = (slackUserId: string) => {
    setErrors((prev) => {
      if (!(slackUserId in prev)) return prev;
      const next = { ...prev };
      delete next[slackUserId];
      return next;
    });
  };

  const removeUser = (slackUserId: string) => {
    setUsers((prev) => prev.filter((u) => u.slack_user_id !== slackUserId));
  };

  const handleSelectMember = async (slackUserId: string, member: Member | null) => {
    if (!member) return; // Don't act on cleared selection

    clearError(slackUserId);
    setMatchingUserId(slackUserId);

    try {
      const response = await fetch("/api/aliases/slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: member.id, slack_user_id: slackUserId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create alias");
      }

      removeUser(slackUserId);
    } catch (error: any) {
      setErrors((prev) => ({ ...prev, [slackUserId]: error.message }));
    } finally {
      setMatchingUserId(null);
    }
  };

  const handleSkip = async (slackUserId: string) => {
    clearError(slackUserId);
    setSkippingUserId(slackUserId);

    try {
      const reason = skipReason[slackUserId] || "non_member";
      const response = await fetch("/api/data-hygiene/slack-users/skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slack_user_id: slackUserId, reason }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to skip user");
      }

      removeUser(slackUserId);
    } catch (error: any) {
      setErrors((prev) => ({ ...prev, [slackUserId]: error.message }));
    } finally {
      setSkippingUserId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
        <div className="p-6 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-lg font-bold">Unmatched Slack Users</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Search for a member to create an alias, or skip users who aren&apos;t members
          </p>
          <div className="mt-2 text-2xl font-bold text-blue-600 dark:text-blue-400">
            {users.length}
          </div>
        </div>

        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {users.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              All matched! 🎉
            </div>
          ) : (
            users.map((user) => (
              <div key={user.slack_user_id} className="p-3">
                <div className="grid grid-cols-[300px_1fr_auto] gap-4 items-start">
                  {/* Left: Name and metadata */}
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {user.real_name || user.display_name || (
                        <span className="font-mono text-slate-500">{user.slack_user_id}</span>
                      )}
                    </div>
                    {user.display_name && user.display_name !== user.real_name && (
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        &quot;{user.display_name}&quot;
                      </div>
                    )}
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {user.message_count} message{user.message_count === 1 ? "" : "s"}
                    </div>
                    {user.email && (
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {user.email}
                      </div>
                    )}
                    {errors[user.slack_user_id] && (
                      <div className="text-xs text-red-600 dark:text-red-400 mt-1">
                        {errors[user.slack_user_id]}
                      </div>
                    )}
                  </div>

                  {/* Middle: Suggestions + member search */}
                  <div>
                    {suggestionsByUserId.get(user.slack_user_id)!.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-1.5">
                        {suggestionsByUserId.get(user.slack_user_id)!.map(({ member }) => (
                          <button
                            key={member.id}
                            type="button"
                            onClick={() => handleSelectMember(user.slack_user_id, member)}
                            disabled={matchingUserId === user.slack_user_id}
                            className="px-2 py-1 text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-full hover:bg-blue-100 dark:hover:bg-blue-900/40 disabled:opacity-50"
                            title={member.email}
                          >
                            {member.name}
                          </button>
                        ))}
                      </div>
                    )}
                    <MemberSearch
                      members={allMembers}
                      selectedMemberId={null}
                      onSelect={(member) => handleSelectMember(user.slack_user_id, member)}
                      placeholder={
                        matchingUserId === user.slack_user_id
                          ? "Matching..."
                          : "Search for member..."
                      }
                    />
                  </div>

                  {/* Right: Skip action */}
                  <div className="flex items-center gap-2">
                    <select
                      value={skipReason[user.slack_user_id] || "non_member"}
                      onChange={(e) =>
                        setSkipReason((prev) => ({
                          ...prev,
                          [user.slack_user_id]: e.target.value as SkipReason,
                        }))
                      }
                      className="px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                    >
                      {SKIP_REASONS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleSkip(user.slack_user_id)}
                      disabled={skippingUserId === user.slack_user_id}
                      className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 border border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500 rounded disabled:opacity-50"
                    >
                      {skippingUserId === user.slack_user_id ? "Skipping..." : "Skip"}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Instructions */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <p className="text-sm text-blue-800 dark:text-blue-200">
          <strong>How to match:</strong> Type in the search box to find a member by name or
          email — selecting one immediately links that Slack user to the member. If a Slack
          user isn&apos;t a member (e.g. a guest or bot that slipped through), choose a reason
          and click &quot;Skip&quot; to stop them from showing up here.
        </p>
      </div>
    </div>
  );
}
