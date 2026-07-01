"use client";

import { useState } from "react";

interface Member {
  id: string;
  name: string;
  email: string;
}

interface MemberSearchProps {
  members: Member[];
  selectedMemberId: string | null;
  selectedMemberName?: string | null;
  onSelect: (member: Member | null) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Reusable member search/autocomplete component
 * Shows selected member with clear button, or search input with dropdown
 */
export default function MemberSearch({
  members,
  selectedMemberId,
  selectedMemberName,
  onSelect,
  placeholder = "Search for member...",
  className = "",
}: MemberSearchProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  const selectedMember = selectedMemberId
    ? members.find((m) => m.id === selectedMemberId)
    : null;

  const displayName = selectedMember?.name || selectedMemberName;

  // Filter members based on search term
  const filteredMembers = searchTerm
    ? members
        .filter(
          (m) =>
            m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            m.email.toLowerCase().includes(searchTerm.toLowerCase())
        )
        .slice(0, 10)
    : [];

  const showDropdown = isFocused && filteredMembers.length > 0;

  function handleSelect(member: Member | null) {
    onSelect(member);
    setSearchTerm("");
    setIsFocused(false);
  }

  return (
    <div className={`relative ${className}`}>
      {displayName && !isFocused ? (
        <div className="flex items-center justify-between px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded text-sm text-slate-900 dark:text-slate-100">
          <span className="flex-1 truncate">{displayName}</span>
          <button
            type="button"
            onClick={() => handleSelect(null)}
            className="ml-2 text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300"
            title="Clear selection"
          >
            ✕
          </button>
        </div>
      ) : (
        <>
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
                  onClick={() => handleSelect(member)}
                  className="w-full px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-slate-700 border-b border-slate-100 dark:border-slate-700 last:border-b-0"
                >
                  <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">{member.name}</div>
                  <div className="text-xs text-gray-600 dark:text-slate-400">{member.email}</div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
