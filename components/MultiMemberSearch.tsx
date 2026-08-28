"use client";

import { useState } from "react";

interface Member {
  id: string;
  name: string;
  email: string;
}

interface MultiMemberSearchProps {
  members: Member[];
  selectedMemberIds: string[];
  onChange: (memberIds: string[]) => void;
  placeholder?: string;
  className?: string;
}

/** Multi-select variant of MemberSearch — selected members show as removable chips. */
export default function MultiMemberSearch({
  members,
  selectedMemberIds,
  onChange,
  placeholder = "Search for a member...",
  className = "",
}: MultiMemberSearchProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  const selectedMembers = selectedMemberIds
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is Member => Boolean(m));

  const filteredMembers = searchTerm
    ? members
        .filter(
          (m) =>
            !selectedMemberIds.includes(m.id) &&
            (m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
              m.email.toLowerCase().includes(searchTerm.toLowerCase()))
        )
        .slice(0, 10)
    : [];

  const showDropdown = isFocused && filteredMembers.length > 0;

  function addMember(member: Member) {
    onChange([...selectedMemberIds, member.id]);
    setSearchTerm("");
  }

  function removeMember(memberId: string) {
    onChange(selectedMemberIds.filter((id) => id !== memberId));
  }

  return (
    <div className={className}>
      {selectedMembers.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {selectedMembers.map((member) => (
            <span
              key={member.id}
              className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm"
            >
              {member.name}
              <button
                type="button"
                onClick={() => removeMember(member.id)}
                className="text-blue-400 hover:text-blue-600 dark:text-blue-500 dark:hover:text-blue-300"
                title={`Remove ${member.name}`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <input
          type="text"
          placeholder={placeholder}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded text-sm text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {showDropdown && (
          <div className="absolute z-10 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
            {filteredMembers.map((member) => (
              <button
                key={member.id}
                type="button"
                onClick={() => addMember(member)}
                className="w-full px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-slate-700 border-b border-slate-100 dark:border-slate-700 last:border-b-0"
              >
                <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">{member.name}</div>
                <div className="text-xs text-gray-600 dark:text-slate-400">{member.email}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
