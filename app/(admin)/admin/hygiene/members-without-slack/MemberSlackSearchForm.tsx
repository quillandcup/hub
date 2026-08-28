"use client";

import { useState } from "react";

interface Member {
  id: string;
  name: string;
  email: string;
}

interface SlackUser {
  user_id: string;
  email: string | null;
  real_name: string | null;
  display_name: string | null;
  is_deleted?: boolean;
}

function SlackUserSearch({
  slackUsers,
  onSelect,
  disabled,
}: {
  slackUsers: SlackUser[];
  onSelect: (user: SlackUser) => void;
  disabled: boolean;
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  const filtered = searchTerm
    ? slackUsers
        .filter((u) => {
          const term = searchTerm.toLowerCase();
          return (
            u.real_name?.toLowerCase().includes(term) ||
            u.display_name?.toLowerCase().includes(term) ||
            u.email?.toLowerCase().includes(term)
          );
        })
        .slice(0, 10)
    : [];

  const showDropdown = isFocused && filtered.length > 0;

  function handleSelect(user: SlackUser) {
    onSelect(user);
    setSearchTerm("");
    setIsFocused(false);
  }

  return (
    <div className="relative">
      <input
        type="text"
        placeholder={disabled ? "Matching..." : "Search Slack users..."}
        value={searchTerm}
        disabled={disabled}
        onChange={(e) => setSearchTerm(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setTimeout(() => setIsFocused(false), 200)}
        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded text-sm text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
      />
      {showDropdown && (
        <div className="absolute z-10 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {filtered.map((user) => (
            <button
              key={user.user_id}
              type="button"
              onClick={() => handleSelect(user)}
              className="w-full px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-slate-700 border-b border-slate-100 dark:border-slate-700 last:border-b-0"
            >
              <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                {user.real_name || user.display_name || user.user_id}
                {user.is_deleted && (
                  <span className="ml-1.5 text-xs font-normal text-slate-400">(deactivated)</span>
                )}
              </div>
              {user.email && <div className="text-xs text-gray-600 dark:text-slate-400">{user.email}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MemberSlackSearchForm({
  unmatchedMembers,
  slackUsers,
}: {
  unmatchedMembers: Member[];
  slackUsers: SlackUser[];
}) {
  const [members, setMembers] = useState(unmatchedMembers);
  const [matchingMemberId, setMatchingMemberId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const removeMember = (memberId: string) => {
    setMembers((prev) => prev.filter((m) => m.id !== memberId));
  };

  const handleSelectSlackUser = async (memberId: string, slackUser: SlackUser) => {
    setErrors((prev) => {
      if (!(memberId in prev)) return prev;
      const next = { ...prev };
      delete next[memberId];
      return next;
    });
    setMatchingMemberId(memberId);

    try {
      const response = await fetch("/api/aliases/slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: memberId, slack_user_id: slackUser.user_id }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to create alias");

      removeMember(memberId);
    } catch (error: any) {
      setErrors((prev) => ({ ...prev, [memberId]: error.message }));
    } finally {
      setMatchingMemberId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
        <div className="p-6 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-lg font-bold">Members Without Slack</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Search Slack users to link, or leave as-is if the member genuinely isn&apos;t on Slack.
          </p>
          <div className="mt-2 text-2xl font-bold text-blue-600 dark:text-blue-400">{members.length}</div>
        </div>

        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {members.length === 0 ? (
            <div className="p-12 text-center text-slate-500">All active members are linked to Slack! 🎉</div>
          ) : (
            members.map((member) => (
              <div key={member.id} className="p-3">
                <div className="grid grid-cols-[300px_1fr] gap-4 items-start">
                  <div>
                    <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">{member.name}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{member.email}</div>
                    {errors[member.id] && (
                      <div className="text-xs text-red-600 dark:text-red-400 mt-1">{errors[member.id]}</div>
                    )}
                  </div>
                  <SlackUserSearch
                    slackUsers={slackUsers}
                    disabled={matchingMemberId === member.id}
                    onSelect={(user) => handleSelectSlackUser(member.id, user)}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <p className="text-sm text-blue-800 dark:text-blue-200">
          <strong>How to match:</strong> Type in the search box to find the member&apos;s Slack account by
          name or email — selecting one immediately links them. If a member truly isn&apos;t in the Slack
          workspace, invite them there, or make peace with them staying out of Slack-dependent features
          like Wheel of Wonder.
        </p>
      </div>
    </div>
  );
}
